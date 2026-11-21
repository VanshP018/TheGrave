import type { Redis } from 'ioredis';

/** Go-style durations from Groq's rate-limit headers: "7.66s", "2m59.56s", "1h0m0s", "250ms". Null if unparseable. */
export function parseGroqDuration(text: string | null | undefined): number | null {
  if (!text) return null;
  const s = text.trim();
  if (!/^(?:\d+(?:\.\d+)?(?:ms|h|m|s))+$/.test(s)) return null;
  let ms = 0;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    const n = Number(m[1]);
    ms += n * (m[2] === 'ms' ? 1 : m[2] === 's' ? 1000 : m[2] === 'm' ? 60_000 : 3_600_000);
  }
  return Math.round(ms);
}

export interface LimiterBudget {
  /** Interviews' share of the model's tokens per minute / requests per minute. */
  tpm: number;
  rpm: number;
  /** Tokens per UTC day; 0 = no cap. */
  dailyTokens: number;
}

export interface Reservation {
  id: string;
  model: string;
  tokens: number;
  at: number;
}

export type Acquire =
  | { ok: true; reservation: Reservation }
  | { ok: false; waitMs: number }
  /** The daily token budget is spent; waiting for the minute window will not help. */
  | { ok: false; daily: true; waitMs: number };

const WINDOW_MS = 60_000;
const DAY_MS = 86_400_000;

// KEYS: tpm zset, rpm zset, daily counter, pause key. ARGV: now, tokens, id, tpm, rpm, daily, window, dayTtl.
// Members of the tpm set are "<id>:<tokens>" scored by time. Returns { code, wait }: 0 reserved, 1 wait, 2 daily.
const ACQUIRE = `
local now = tonumber(ARGV[1])
local tokens = tonumber(ARGV[2])
local window = tonumber(ARGV[7])
local pause = tonumber(redis.call('GET', KEYS[4]) or '0')
if pause > now then return {1, pause - now} end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - window)
local used = 0
for _, m in ipairs(redis.call('ZRANGE', KEYS[1], 0, -1)) do
  used = used + tonumber(string.match(m, ':(%d+)$') or '0')
end
local daily = tonumber(redis.call('GET', KEYS[3]) or '0')
local dailyBudget = tonumber(ARGV[6])
if dailyBudget > 0 and daily + tokens > dailyBudget then return {2, 0} end
local tpm = tonumber(ARGV[4])
-- a request that cannot fit even an empty window is let through (Groq decides); waiting would never end
if used > 0 and used + tokens > tpm then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {1, math.max(100, tonumber(oldest[2]) + window - now)}
end
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[5]) then
  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  return {1, math.max(100, tonumber(oldest[2]) + window - now)}
end
redis.call('ZADD', KEYS[1], now, ARGV[3] .. ':' .. tokens)
redis.call('ZADD', KEYS[2], now, ARGV[3])
redis.call('INCRBY', KEYS[3], tokens)
redis.call('PEXPIRE', KEYS[3], ARGV[8])
redis.call('PEXPIRE', KEYS[1], window * 2)
redis.call('PEXPIRE', KEYS[2], window * 2)
return {0, 0}
`;

/**
 * Redis-backed budget shared by every interview worker process, per model (plan.md 6.9): a 60 s sliding window of
 * token reservations and requests, a UTC daily token counter, a pause set from 429s and rate-limit headers, and an
 * "exhausted" flag for daily limits. Reservations are settled to the real cost once the response arrives.
 */
export class GroqLimiter {
  private seq = 0;

  constructor(
    private readonly redis: Redis,
    private readonly budget: LimiterBudget,
    private readonly now: () => number = Date.now,
    private readonly prefix = 'interviews:groq',
  ) {}

  private key(model: string, part: string): string {
    return `${this.prefix}:${model}:${part}`;
  }

  private dayKey(model: string, at: number): string {
    return this.key(model, `tpd:${new Date(at).toISOString().slice(0, 10).replaceAll('-', '')}`);
  }

  async acquire(model: string, tokens: number): Promise<Acquire> {
    const now = this.now();
    const id = `${now}-${process.pid}-${this.seq++}-${Math.random().toString(36).slice(2, 8)}`;
    const res = (await this.redis.eval(
      ACQUIRE,
      4,
      this.key(model, 'tpm'),
      this.key(model, 'rpm'),
      this.dayKey(model, now),
      this.key(model, 'pause_until'),
      now,
      tokens,
      id,
      this.budget.tpm,
      this.budget.rpm,
      this.budget.dailyTokens,
      WINDOW_MS,
      DAY_MS * 2,
    )) as [number, number];
    if (res[0] === 0) return { ok: true, reservation: { id, model, tokens, at: now } };
    if (res[0] === 2) {
      const midnight = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
      return { ok: false, daily: true, waitMs: midnight - now };
    }
    return { ok: false, waitMs: res[1] };
  }

  /** Replace a reservation with what the call really cost (cached input tokens do not count, 0 for a failure). */
  async settle(r: Reservation, actualTokens: number): Promise<void> {
    const actual = Math.max(0, Math.round(actualTokens));
    if (actual === r.tokens) return;
    await this.redis
      .multi()
      .zrem(this.key(r.model, 'tpm'), `${r.id}:${r.tokens}`)
      .zadd(this.key(r.model, 'tpm'), r.at, `${r.id}:${actual}`)
      .incrby(this.dayKey(r.model, r.at), actual - r.tokens)
      .exec();
  }

  /** Block the model until `untilMs` (a 429's retry-after, or a header saying the minute budget is spent). */
  async pause(model: string, untilMs: number): Promise<void> {
    const key = this.key(model, 'pause_until');
    const current = Number(await this.redis.get(key)) || 0;
    if (untilMs > current)
      await this.redis.set(key, String(untilMs), 'PX', Math.max(1000, untilMs - this.now() + 1000));
  }

  /** Daily limit reached: the flag lives for the wait (capped at 24 h) and makes POSTs answer 503 (Phase 4). */
  async markExhausted(model: string, waitMs: number): Promise<void> {
    const ttl = Math.min(Math.max(waitMs, 1000), DAY_MS);
    await this.redis.set(this.exhaustedKey(model), String(this.now() + ttl), 'PX', ttl);
  }

  /** Epoch ms the exhausted flag expires, or null. */
  async exhaustedUntil(model: string): Promise<number | null> {
    const v = await this.redis.get(this.exhaustedKey(model));
    return v ? Number(v) : null;
  }

  private exhaustedKey(model: string): string {
    return `${this.prefix}:exhausted:${model}`;
  }

  /** Tokens currently reserved in the minute window (for tests and logging). */
  async windowTokens(model: string): Promise<number> {
    await this.redis.zremrangebyscore(
      this.key(model, 'tpm'),
      '-inf',
      String(this.now() - WINDOW_MS),
    );
    const members = await this.redis.zrange(this.key(model, 'tpm'), '0', '-1');
    return members.reduce((n, m) => n + Number(/:(\d+)$/.exec(m)?.[1] ?? 0), 0);
  }
}
