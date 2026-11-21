import { createHash } from 'node:crypto';
import type { MatchMode } from '@thegrave/shared';
import type { Redis } from 'ioredis';

/**
 * Matchmaking state lives entirely in Redis and is only ever mutated by these Lua scripts, so every
 * transition (join, pair, accept, decline, expire, purge) is atomic across all API nodes (decision.md D-034).
 *
 *   mm:queue            ZSET  userId -> rating
 *   mm:joined           ZSET  userId -> joinedAt (ms)     oldest-first iteration, wait-time windows
 *   mm:lease            ZSET  userId -> lease expiry (ms) renewed by whichever node holds the user's socket
 *   mm:ready:deadlines  ZSET  readyId -> deadline (ms)
 *   mm:seq              STRING counter for ready-check ids
 *   mm:ready:{id}       HASH  a, b, ra, rb, ja, jb, acc_a, acc_b
 *   user:{id}:state     STRING 'queued' | 'queued:programming' | 'ready:{id}' | 'match:{id}' | 'room:{code}'
 *
 * Each mode has its own queue (decision.md D-067): the DSA keys above, and the same set prefixed
 * `mm:programming:` for programming battles. `mm:seq`, the ready hashes and the user state are shared, so
 * ready ids never collide and a user can be in at most one queue, ready check, room or match.
 *
 * Time always comes from Redis TIME, so node clock skew cannot affect windows or deadlines.
 * Keys built inside scripts (user state, ready hashes) assume a single Redis, not Redis Cluster.
 */
export const KEYS = ['mm:queue', 'mm:joined', 'mm:lease', 'mm:ready:deadlines', 'mm:seq', 'DSA'];

/** The key set for one mode's queue; KEYS[6] carries the mode into the scripts. */
export function keysFor(mode: MatchMode): string[] {
  if (mode === 'DSA') return KEYS;
  const p = 'mm:programming:';
  return [`${p}queue`, `${p}joined`, `${p}lease`, `${p}ready:deadlines`, 'mm:seq', mode];
}

/** The user-state value meaning "in this mode's queue". DSA keeps the original 'queued'. */
export const queuedState = (mode: MatchMode) => (mode === 'DSA' ? 'queued' : 'queued:programming');

const PRELUDE = `
local Q, J, L, D, SEQ = KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5]
local QUEUED = KEYS[6] == 'DSA' and 'queued' or 'queued:programming'
local function nowMs()
  local t = redis.call('TIME')
  return tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
end
local function stateKey(u) return 'user:' .. u .. ':state' end
local function readyKey(id) return 'mm:ready:' .. id end
local function dequeue(u)
  redis.call('ZREM', Q, u)
  redis.call('ZREM', J, u)
  redis.call('ZREM', L, u)
end
local function enqueue(u, rating, joinedAt, leaseUntil)
  redis.call('ZADD', Q, rating, u)
  redis.call('ZADD', J, joinedAt, u)
  redis.call('ZADD', L, leaseUntil, u)
  redis.call('SET', stateKey(u), QUEUED)
end
`;

/** ARGV: userId, rating, leaseMs → {'ok', joinedAt} | {'already', joinedAt} | {'busy', state} */
const JOIN = `
local u, rating, leaseMs = ARGV[1], ARGV[2], tonumber(ARGV[3])
local now = nowMs()
local st = redis.call('GET', stateKey(u))
if st and st ~= QUEUED then return {'busy', st} end
local joined = redis.call('ZSCORE', J, u)
if joined then
  redis.call('ZADD', L, now + leaseMs, u)
  return {'already', joined}
end
enqueue(u, rating, now, now + leaseMs)
return {'ok', tostring(now)}
`;

/** ARGV: userId → 1 if the user was queued */
const LEAVE = `
local u = ARGV[1]
local removed = redis.call('ZREM', J, u)
redis.call('ZREM', Q, u)
redis.call('ZREM', L, u)
if redis.call('GET', stateKey(u)) == QUEUED then redis.call('DEL', stateKey(u)) end
return removed
`;

/**
 * One matchmaking pass. ARGV: base, step, stepMs, max, readyTimeoutMs, leaseMs, maxPairs, stateTtlMs
 * Returns { purged[], expired[[id, a, accA, b, accB]], pairs[[id, a, ra, b, rb, deadline]], queuedCount }
 */
const TICK = `
local base, step, stepMs, maxW = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local readyMs, leaseMs, maxPairs, stateTtl = tonumber(ARGV[5]), tonumber(ARGV[6]), tonumber(ARGV[7]), tonumber(ARGV[8])
local now = nowMs()

-- 1. Purge queue entries whose lease lapsed: no node holds a socket for them (e.g. that node crashed).
local purged = redis.call('ZRANGEBYSCORE', L, '-inf', now)
for _, u in ipairs(purged) do
  dequeue(u)
  if redis.call('GET', stateKey(u)) == QUEUED then redis.call('DEL', stateKey(u)) end
end

-- 2. Expire ready checks: players who accepted go back to the queue with their original joinedAt,
--    players who did not respond are dropped (so an AFK player can't keep blocking others).
local expired = {}
for _, id in ipairs(redis.call('ZRANGEBYSCORE', D, '-inf', now)) do
  redis.call('ZREM', D, id)
  local h = redis.call('HMGET', readyKey(id), 'a', 'b', 'ra', 'rb', 'ja', 'jb', 'acc_a', 'acc_b', 'bot')
  redis.call('DEL', readyKey(id))
  if h[1] then
    -- h[9] says which side is a practice bot ('a' | 'b'); a bot is freed, never queued.
    local players = { {h[1], h[3], h[5], h[7], h[9] == 'a'}, {h[2], h[4], h[6], h[8], h[9] == 'b'} }
    for _, p in ipairs(players) do
      if redis.call('GET', stateKey(p[1])) == 'ready:' .. id then
        if p[4] == '1' and not p[5] then enqueue(p[1], p[2], p[3], now + leaseMs) else redis.call('DEL', stateKey(p[1])) end
      end
    end
    expired[#expired + 1] = {id, h[1], h[7], h[2], h[8]}
  end
end

-- 3. Pair players, longest-waiting first. Each picks the closest rating inside its own window, which
--    widens with wait time; ties go to whoever has waited longer.
local matched = {}
local taken = {}
local waiting = redis.call('ZRANGE', J, 0, -1, 'WITHSCORES')
for i = 1, #waiting, 2 do
  if #matched >= maxPairs then break end
  local u = waiting[i]
  local r = redis.call('ZSCORE', Q, u)
  if not taken[u] and r then
    r = tonumber(r)
    local joined = tonumber(waiting[i + 1])
    local w = math.min(base + step * math.floor((now - joined) / stepMs), maxW)
    local best, bestR, bestDiff, bestJoined = nil, nil, nil, nil
    local function consider(list)
      for k = 1, #list, 2 do
        local c, cr = list[k], tonumber(list[k + 1])
        if c ~= u then
          local diff = math.abs(cr - r)
          local cj = tonumber(redis.call('ZSCORE', J, c))
          if best == nil or diff < bestDiff or (diff == bestDiff and cj < bestJoined) then
            best, bestR, bestDiff, bestJoined = c, cr, diff, cj
          end
        end
      end
    end
    -- 3 per side is enough: at most one of them is u itself (equal scores).
    consider(redis.call('ZREVRANGEBYSCORE', Q, r, r - w, 'WITHSCORES', 'LIMIT', 0, 3))
    consider(redis.call('ZRANGEBYSCORE', Q, r, r + w, 'WITHSCORES', 'LIMIT', 0, 3))
    if best then
      taken[u], taken[best] = true, true
      dequeue(u)
      dequeue(best)
      local id = tostring(redis.call('INCR', SEQ))
      local deadline = now + readyMs
      redis.call('HSET', readyKey(id), 'a', u, 'b', best, 'ra', tostring(r), 'rb', tostring(bestR),
        'ja', tostring(joined), 'jb', tostring(bestJoined), 'acc_a', '0', 'acc_b', '0')
      redis.call('PEXPIRE', readyKey(id), readyMs + stateTtl)
      redis.call('ZADD', D, deadline, id)
      redis.call('SET', stateKey(u), 'ready:' .. id, 'PX', readyMs + stateTtl)
      redis.call('SET', stateKey(best), 'ready:' .. id, 'PX', readyMs + stateTtl)
      matched[#matched + 1] = {id, u, tostring(r), best, tostring(bestR), tostring(deadline)}
    end
  end
end

return {purged, expired, matched, redis.call('ZCARD', Q)}
`;

/**
 * Pairs a waiting human with a practice bot, as a ready check the bot has already accepted.
 * ARGV: userId, botId, botRating, readyMs, stateTtlMs → {id, humanRating, deadline} | {} (not queued, or bot busy)
 */
const PAIR_BOT = `
local u, bot, botRating, readyMs, stateTtl = ARGV[1], ARGV[2], ARGV[3], tonumber(ARGV[4]), tonumber(ARGV[5])
local rating = redis.call('ZSCORE', Q, u)
local joined = redis.call('ZSCORE', J, u)
if not rating or not joined or redis.call('GET', stateKey(u)) ~= QUEUED then return {} end
if redis.call('GET', stateKey(bot)) then return {} end
local now = nowMs()
local deadline = now + readyMs
dequeue(u)
local id = tostring(redis.call('INCR', SEQ))
redis.call('HSET', readyKey(id), 'a', u, 'b', bot, 'ra', rating, 'rb', botRating,
  'ja', joined, 'jb', tostring(now), 'acc_a', '0', 'acc_b', '1', 'bot', 'b')
redis.call('PEXPIRE', readyKey(id), readyMs + stateTtl)
redis.call('ZADD', D, deadline, id)
redis.call('SET', stateKey(u), 'ready:' .. id, 'PX', readyMs + stateTtl)
redis.call('SET', stateKey(bot), 'ready:' .. id, 'PX', readyMs + stateTtl)
return {id, rating, tostring(deadline)}
`;

/** ARGV: readyId, userId, matchStateTtlMs → {'waiting'} | {'confirmed', a, b, ra, rb} | {'gone'} */
const ACCEPT = `
local id, u, matchTtl = ARGV[1], ARGV[2], tonumber(ARGV[3])
local deadline = redis.call('ZSCORE', D, id)
if not deadline or nowMs() > tonumber(deadline) then return {'gone'} end
local h = redis.call('HMGET', readyKey(id), 'a', 'b', 'ra', 'rb')
local field
if h[1] == u then field = 'acc_a' elseif h[2] == u then field = 'acc_b' else return {'gone'} end
redis.call('HSET', readyKey(id), field, '1')
local acc = redis.call('HMGET', readyKey(id), 'acc_a', 'acc_b')
if acc[1] == '1' and acc[2] == '1' then
  redis.call('DEL', readyKey(id))
  redis.call('ZREM', D, id)
  redis.call('SET', stateKey(h[1]), 'match:' .. id, 'PX', matchTtl)
  redis.call('SET', stateKey(h[2]), 'match:' .. id, 'PX', matchTtl)
  return {'confirmed', h[1], h[2], h[3], h[4]}
end
return {'waiting', h[1], h[2]}
`;

/** ARGV: readyId, userId, leaseMs → {'declined', otherUserId, requeued(0|1)} | {'gone'} */
const DECLINE = `
local id, u, leaseMs = ARGV[1], ARGV[2], tonumber(ARGV[3])
local h = redis.call('HMGET', readyKey(id), 'a', 'b', 'ra', 'rb', 'ja', 'jb', 'bot')
local other, oRating, oJoined, otherIsBot
if h[1] == u then other, oRating, oJoined, otherIsBot = h[2], h[4], h[6], h[7] == 'b'
elseif h[2] == u then other, oRating, oJoined, otherIsBot = h[1], h[3], h[5], h[7] == 'a'
else return {'gone'} end
redis.call('DEL', readyKey(id))
redis.call('ZREM', D, id)
if redis.call('GET', stateKey(u)) == 'ready:' .. id then redis.call('DEL', stateKey(u)) end
local requeued = 0
if redis.call('GET', stateKey(other)) == 'ready:' .. id then
  if otherIsBot then
    redis.call('DEL', stateKey(other))
  else
    enqueue(other, oRating, oJoined, nowMs() + leaseMs)
    requeued = 1
  end
end
return {'declined', other, requeued}
`;

/** ARGV: matchId, userIds... → number of users released (compare-and-delete on 'match:{id}') */
const RELEASE = `
local released = 0
for i = 2, #ARGV do
  local k = stateKey(ARGV[i])
  if redis.call('GET', k) == 'match:' .. ARGV[1] then
    redis.call('DEL', k)
    released = released + 1
  end
end
return released
`;

/** ARGV: fromId, toId, ttlMs, userIds... → moves 'match:{from}' to 'match:{to}' (ready id → Match id) */
const REBIND = `
local moved = 0
for i = 4, #ARGV do
  local k = stateKey(ARGV[i])
  if redis.call('GET', k) == 'match:' .. ARGV[1] then
    redis.call('SET', k, 'match:' .. ARGV[2], 'PX', tonumber(ARGV[3]))
    moved = moved + 1
  end
end
return moved
`;

/** ARGV: userId → {state, joinedAt|readyHash...} for resyncing a (re)connecting socket. */
const DESCRIBE = `
local u = ARGV[1]
local st = redis.call('GET', stateKey(u))
if not st then return {} end
if st == QUEUED then return {st, redis.call('ZSCORE', J, u) or ''} end
local id = string.match(st, '^ready:(.+)$')
if id then
  local h = redis.call('HMGET', readyKey(id), 'a', 'b', 'ra', 'rb')
  return {st, id, h[1] or '', h[2] or '', h[3] or '', h[4] or '', redis.call('ZSCORE', D, id) or ''}
end
return {st}
`;

class LuaScript {
  readonly sha: string;
  constructor(readonly source: string) {
    this.sha = createHash('sha1').update(source).digest('hex');
  }
  /** EVALSHA with a one-time EVAL fallback after a Redis restart/flush (NOSCRIPT). */
  async run<T>(redis: Redis, args: (string | number)[], keys: string[] = KEYS): Promise<T> {
    try {
      return (await redis.evalsha(this.sha, keys.length, ...keys, ...args)) as T;
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('NOSCRIPT')) throw err;
      return (await redis.eval(this.source, keys.length, ...keys, ...args)) as T;
    }
  }
}

const script = (body: string) => new LuaScript(PRELUDE + body);
export const scripts = {
  join: script(JOIN),
  leave: script(LEAVE),
  tick: script(TICK),
  pairBot: script(PAIR_BOT),
  accept: script(ACCEPT),
  decline: script(DECLINE),
  release: script(RELEASE),
  rebind: script(REBIND),
  describe: script(DESCRIBE),
};
