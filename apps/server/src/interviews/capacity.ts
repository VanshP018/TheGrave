import type { Redis } from 'ioredis';
import type { TierBudget } from './budget.js';

/** Rough tokens one analysis spends on the writer model's daily budget (free tier: ~28k, plan.md 7.2). */
export const ANALYSIS_DAILY_TOKENS = 28_000;
const DAY_MS = 86_400_000;

export type Capacity = { available: true } | { available: false; retryAt: Date };

const dayStamp = (at: number) => new Date(at).toISOString().slice(0, 10).replaceAll('-', '');
const nextMidnight = (at: number) => new Date(Math.floor(at / DAY_MS) * DAY_MS + DAY_MS);

export const spendKey = (at = Date.now()) => `interviews:spend:${dayStamp(at)}`;

/** Adds spend to today's global counter (48 h TTL), so retries and failed analyses still count. */
export async function recordSpend(redis: Redis, microUsd: number, at = Date.now()): Promise<void> {
  if (microUsd <= 0) return;
  const key = spendKey(at);
  await redis
    .multi()
    .incrby(key, Math.round(microUsd))
    .expire(key, 48 * 3600)
    .exec();
}

export interface CapacityEnv {
  redis: Redis;
  budget: TierBudget;
  /** Writer, triage and critique model ids: any with an exhausted flag blocks new analyses. */
  models: string[];
  /** 0 = no cap. */
  dailyBudgetUsd: number;
  now?: () => number;
}

/**
 * Global caps (plan.md 7.2): today's spend, the Groq-exhausted flag the client sets on a long 429
 * (interviews:groq:exhausted:{model}), and whether the writer model's daily token budget fits one more analysis.
 * Checked at POST and again by the worker before the writer runs.
 */
export async function checkCapacity(env: CapacityEnv): Promise<Capacity> {
  const now = (env.now ?? Date.now)();
  const models = [...new Set(env.models)];
  const writer = models[0];
  const [spent, ...rest] = await Promise.all([
    env.redis.get(spendKey(now)),
    ...models.map((m) => env.redis.get(`interviews:groq:exhausted:${m}`)),
    writer && env.budget.dailyTokens > 0
      ? env.redis.get(`interviews:groq:${writer}:tpd:${dayStamp(now)}`)
      : Promise.resolve(null),
  ]);
  const used = rest.pop() as string | null;
  const blocked: Date[] = [];
  for (const v of rest) if (v && Number(v) > now) blocked.push(new Date(Number(v)));
  if (env.dailyBudgetUsd > 0 && Number(spent ?? 0) >= env.dailyBudgetUsd * 1_000_000)
    blocked.push(nextMidnight(now));
  if (
    env.budget.dailyTokens > 0 &&
    Number(used ?? 0) + ANALYSIS_DAILY_TOKENS > env.budget.dailyTokens
  )
    blocked.push(nextMidnight(now));
  if (blocked.length === 0) return { available: true };
  return { available: false, retryAt: new Date(Math.max(...blocked.map((d) => d.getTime()))) };
}
