import { describe, expect, it } from 'vitest';
import { REQUEST_OVERHEAD_TOKENS, TIER_PROFILES, resolveBudget } from '../src/interviews/budget.js';
import { envSchema } from '../src/config.js';

const env = (over: Record<string, unknown> = {}) => ({
  GROQ_TIER: 'developer' as const,
  INTERVIEW_WRITER_EFFORT: undefined,
  INTERVIEW_DAILY_LIMIT: undefined,
  INTERVIEW_QUEUE_MAX: undefined,
  INTERVIEW_MAX_REQUEST_TOKENS: undefined,
  INTERVIEW_CONTEXT_TOKENS: undefined,
  INTERVIEW_TPM_BUDGET: undefined,
  INTERVIEW_DAILY_TOKENS: undefined,
  INTERVIEW_JOB_TIMEOUT_MS: undefined,
  ...over,
});

describe('interview budgets', () => {
  it.each(['developer', 'free'] as const)(
    'the %s profile satisfies the per-request invariant',
    (tier) => {
      const b = resolveBudget(env({ GROQ_TIER: tier }));
      expect(b).toEqual(TIER_PROFILES[tier]);
      expect(b.shardTokens + REQUEST_OVERHEAD_TOKENS + b.writerMaxOut).toBeLessThanOrEqual(
        b.maxRequestTokens,
      );
      expect(b.triageMaxIn + b.triageMaxOut).toBeLessThanOrEqual(b.maxRequestTokens);
      expect(b.critiqueMaxIn + b.critiqueMaxOut).toBeLessThanOrEqual(b.maxRequestTokens);
    },
  );

  it('a free pack is split into shards, a developer pack is not', () => {
    expect(TIER_PROFILES.developer.maxShards).toBe(1);
    expect(TIER_PROFILES.developer.shardTokens).toBe(TIER_PROFILES.developer.contextTokens);
    expect(TIER_PROFILES.free.maxShards).toBeGreaterThan(1);
    expect(TIER_PROFILES.free.shardTokens).toBeLessThan(TIER_PROFILES.free.contextTokens);
  });

  it('throws when an override breaks the invariant', () => {
    expect(() => resolveBudget(env({ INTERVIEW_MAX_REQUEST_TOKENS: 30_000 }))).toThrow(/writer/);
    expect(() => resolveBudget(env({ INTERVIEW_CONTEXT_TOKENS: 55_000 }))).toThrow(/writer/);
    expect(() =>
      resolveBudget(env({ GROQ_TIER: 'free', INTERVIEW_MAX_REQUEST_TOKENS: 5000 })),
    ).toThrow();
  });

  it('overrides win over the profile', () => {
    const b = resolveBudget(
      env({
        INTERVIEW_DAILY_LIMIT: 9,
        INTERVIEW_QUEUE_MAX: 7,
        INTERVIEW_TPM_BUDGET: 123,
        INTERVIEW_DAILY_TOKENS: 456,
        INTERVIEW_JOB_TIMEOUT_MS: 789,
        INTERVIEW_WRITER_EFFORT: 'high',
        INTERVIEW_CONTEXT_TOKENS: 30_000,
        INTERVIEW_MAX_REQUEST_TOKENS: 50_000,
      }),
    );
    expect(b).toMatchObject({
      dailyLimit: 9,
      queueMax: 7,
      tpmBudget: 123,
      dailyTokens: 456,
      jobTimeoutMs: 789,
      writerEffort: 'high',
      contextTokens: 30_000,
      shardTokens: 30_000,
      maxRequestTokens: 50_000,
    });
  });

  it('parses the env: blanks mean unset, values are coerced', () => {
    const base = {
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
    };
    const blank = envSchema.parse({
      ...base,
      INTERVIEW_DAILY_LIMIT: '',
      INTERVIEW_WRITER_EFFORT: '',
    });
    expect(blank.INTERVIEW_DAILY_LIMIT).toBeUndefined();
    expect(blank.INTERVIEW_WRITER_EFFORT).toBeUndefined();
    expect(blank.GROQ_TIER).toBe('developer');
    expect(envSchema.parse({ ...base, INTERVIEW_QUEUE_MAX: '12' }).INTERVIEW_QUEUE_MAX).toBe(12);
  });
});
