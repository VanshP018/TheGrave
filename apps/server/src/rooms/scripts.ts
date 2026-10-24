import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Private-room state, mutated only by these Lua scripts so every transition is atomic across API nodes
 * (decision.md D-065, mirroring the matchmaker's D-034).
 *
 *   room:{code}       HASH   host, guest ('' when empty), ready ('0' | '1'), difficulty, mode (DSA | PROGRAMMING)
 *   user:{id}:state   STRING 'room:{code}' while in a room, the same key the matchmaker uses, so a user
 *                            can never be queued and in a room at once
 *
 * Starting moves both players to 'match:room-{code}', which the battle service rebinds to the Match id.
 */
const PRELUDE = `
local function stateKey(u) return 'user:' .. u .. ':state' end
local function roomKey(c) return 'room:' .. c end
local function roomOf(u)
  local st = redis.call('GET', stateKey(u))
  return st and string.match(st, '^room:(.+)$')
end
`;

/** ARGV: code, userId, ttlMs, mode → {'ok'} | {'busy', state} | {'taken'} */
const CREATE = `
local c, u, ttl, mode = ARGV[1], ARGV[2], tonumber(ARGV[3]), ARGV[4]
local st = redis.call('GET', stateKey(u))
if st then return {'busy', st} end
if redis.call('EXISTS', roomKey(c)) == 1 then return {'taken'} end
redis.call('HSET', roomKey(c), 'host', u, 'guest', '', 'ready', '0', 'difficulty', 'AUTO', 'mode', mode)
redis.call('PEXPIRE', roomKey(c), ttl)
redis.call('SET', stateKey(u), 'room:' .. c, 'PX', ttl)
return {'ok'}
`;

/** ARGV: code, userId, ttlMs → {'ok'} | {'busy', state} | {'gone'} | {'full'} */
const JOIN = `
local c, u, ttl = ARGV[1], ARGV[2], tonumber(ARGV[3])
local st = redis.call('GET', stateKey(u))
if st == 'room:' .. c then return {'ok'} end
if st then return {'busy', st} end
local h = redis.call('HMGET', roomKey(c), 'host', 'guest')
if not h[1] then return {'gone'} end
if h[2] ~= '' then return {'full'} end
redis.call('HSET', roomKey(c), 'guest', u, 'ready', '0')
redis.call('PEXPIRE', roomKey(c), ttl)
redis.call('SET', stateKey(u), 'room:' .. c, 'PX', ttl)
redis.call('PEXPIRE', stateKey(h[1]), ttl)
return {'ok'}
`;

/** ARGV: userId → {'none'} | {'closed', code, guest} (host left) | {'left', code, host} (guest left) */
const LEAVE = `
local u = ARGV[1]
local c = roomOf(u)
if not c then return {'none'} end
redis.call('DEL', stateKey(u))
local h = redis.call('HMGET', roomKey(c), 'host', 'guest')
if not h[1] then return {'none'} end
if h[1] == u then
  redis.call('DEL', roomKey(c))
  if h[2] ~= '' and redis.call('GET', stateKey(h[2])) == 'room:' .. c then redis.call('DEL', stateKey(h[2])) end
  return {'closed', c, h[2]}
end
if h[2] == u then redis.call('HSET', roomKey(c), 'guest', '', 'ready', '0') end
return {'left', c, h[1]}
`;

/**
 * ARGV: userId, field ('difficulty' | 'mode' | 'ready' | 'kick'), value
 * → {'ok', code} | {'kicked', code, guest} | {'none'} | {'denied'}
 * The host sets difficulty and mode (a new mode un-readies the guest) and kicks; only the guest sets ready.
 */
const UPDATE = `
local u, f, v = ARGV[1], ARGV[2], ARGV[3]
local c = roomOf(u)
if not c then return {'none'} end
local h = redis.call('HMGET', roomKey(c), 'host', 'guest')
if not h[1] then return {'none'} end
if f == 'difficulty' then
  if h[1] ~= u then return {'denied'} end
  redis.call('HSET', roomKey(c), 'difficulty', v)
elseif f == 'mode' then
  if h[1] ~= u then return {'denied'} end
  redis.call('HSET', roomKey(c), 'mode', v, 'ready', '0')
elseif f == 'ready' then
  if h[2] ~= u then return {'denied'} end
  redis.call('HSET', roomKey(c), 'ready', v)
elseif f == 'kick' then
  if h[1] ~= u or h[2] == '' then return {'denied'} end
  if redis.call('GET', stateKey(h[2])) == 'room:' .. c then redis.call('DEL', stateKey(h[2])) end
  redis.call('HSET', roomKey(c), 'guest', '', 'ready', '0')
  return {'kicked', c, h[2]}
else
  return {'denied'}
end
return {'ok', c}
`;

/** ARGV: userId, ttlMs → {'ok', code, host, guest, difficulty, mode} | {'none'} | {'denied'} */
const START = `
local u, ttl = ARGV[1], tonumber(ARGV[2])
local c = roomOf(u)
if not c then return {'none'} end
local h = redis.call('HMGET', roomKey(c), 'host', 'guest', 'ready', 'difficulty', 'mode')
if not h[1] then return {'none'} end
if h[1] ~= u or h[2] == '' or h[3] ~= '1' then return {'denied'} end
if redis.call('GET', stateKey(h[2])) ~= 'room:' .. c then return {'denied'} end
redis.call('DEL', roomKey(c))
redis.call('SET', stateKey(h[1]), 'match:room-' .. c, 'PX', ttl)
redis.call('SET', stateKey(h[2]), 'match:room-' .. c, 'PX', ttl)
return {'ok', c, h[1], h[2], h[4], h[5] or 'DSA'}
`;

class LuaScript {
  readonly sha: string;
  constructor(readonly source: string) {
    this.sha = createHash('sha1').update(source).digest('hex');
  }
  /** EVALSHA with a one-time EVAL fallback after a Redis restart/flush (NOSCRIPT). */
  async run<T>(redis: Redis, args: (string | number)[]): Promise<T> {
    try {
      return (await redis.evalsha(this.sha, 0, ...args)) as T;
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('NOSCRIPT')) throw err;
      return (await redis.eval(this.source, 0, ...args)) as T;
    }
  }
}

const script = (body: string) => new LuaScript(PRELUDE + body);
export const roomScripts = {
  create: script(CREATE),
  join: script(JOIN),
  leave: script(LEAVE),
  update: script(UPDATE),
  start: script(START),
};
