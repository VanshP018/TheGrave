import type { Config } from '../config.js';

export type GroqTier = 'free' | 'developer';
export type Effort = 'low' | 'medium' | 'high';

/** Every number the interview pipeline budgets against (plan.md section 6.0). */
export interface TierBudget {
  tier: GroqTier;
  /** Largest single Groq request: prompt estimate + max completion tokens. */
  maxRequestTokens: number;
  /** Interviews' share of the per-model tokens per minute / requests per minute. */
  tpmBudget: number;
  rpmBudget: number;
  /** Per-model daily token budget; 0 = no cap (rely on Groq's headers and 429s). */
  dailyTokens: number;
  triageCandidates: number;
  maxFiles: number;
  /** Whole pack, and the most one file may take of it. */
  contextTokens: number;
  perFileTokens: number;
  /** One writer request sees at most this much of the pack. */
  shardTokens: number;
  maxShards: number;
  questionsPerCall: number;
  maxQuestions: number;
  writerMaxOut: number;
  writerEffort: Effort;
  writerTimeoutMs: number;
  triageMaxIn: number;
  triageMaxOut: number;
  triageTimeoutMs: number;
  critiqueMaxBatches: number;
  critiqueMaxIn: number;
  critiqueMaxOut: number;
  critiqueEffort: Effort;
  topUp: boolean;
  dailyLimit: number;
  queueMax: number;
  jobTimeoutMs: number;
}

/** Tokens a writer request spends on the system prompt, profile and task block on top of the shard. */
export const REQUEST_OVERHEAD_TOKENS = 2000;

export const TIER_PROFILES: Record<GroqTier, TierBudget> = {
  developer: {
    tier: 'developer',
    maxRequestTokens: 60_000,
    tpmBudget: 200_000,
    rpmBudget: 600,
    dailyTokens: 0,
    triageCandidates: 80,
    maxFiles: 20,
    contextTokens: 40_000,
    perFileTokens: 6000,
    shardTokens: 40_000, // one shard: the whole pack
    maxShards: 1,
    questionsPerCall: 14,
    maxQuestions: 14,
    writerMaxOut: 16_000,
    writerEffort: 'medium',
    writerTimeoutMs: 120_000,
    triageMaxIn: 8000,
    triageMaxOut: 3000,
    triageTimeoutMs: 45_000,
    critiqueMaxBatches: 1,
    critiqueMaxIn: 12_000,
    critiqueMaxOut: 4000,
    critiqueEffort: 'medium',
    topUp: true,
    dailyLimit: 3,
    queueMax: 100,
    jobTimeoutMs: 300_000,
  },
  free: {
    tier: 'free',
    maxRequestTokens: 7000,
    tpmBudget: 7000,
    rpmBudget: 20,
    dailyTokens: 150_000,
    triageCandidates: 40,
    maxFiles: 10,
    contextTokens: 10_000,
    perFileTokens: 2500,
    shardTokens: 2500,
    maxShards: 4,
    questionsPerCall: 4,
    maxQuestions: 16,
    writerMaxOut: 2500,
    writerEffort: 'low',
    writerTimeoutMs: 120_000,
    triageMaxIn: 4000,
    triageMaxOut: 1500,
    triageTimeoutMs: 45_000,
    critiqueMaxBatches: 2,
    critiqueMaxIn: 4500,
    critiqueMaxOut: 2000,
    critiqueEffort: 'low',
    topUp: false,
    dailyLimit: 1,
    queueMax: 10,
    jobTimeoutMs: 900_000,
  },
};

type BudgetEnv = Pick<
  Config,
  | 'GROQ_TIER'
  | 'INTERVIEW_WRITER_EFFORT'
  | 'INTERVIEW_DAILY_LIMIT'
  | 'INTERVIEW_QUEUE_MAX'
  | 'INTERVIEW_MAX_REQUEST_TOKENS'
  | 'INTERVIEW_CONTEXT_TOKENS'
  | 'INTERVIEW_TPM_BUDGET'
  | 'INTERVIEW_DAILY_TOKENS'
  | 'INTERVIEW_JOB_TIMEOUT_MS'
>;

/**
 * The tier profile with any env overrides applied. Throws on a combination whose largest request cannot fit
 * `maxRequestTokens`, so a misconfiguration fails at boot instead of as 413s from Groq.
 */
export function resolveBudget(env: BudgetEnv): TierBudget {
  const b: TierBudget = { ...TIER_PROFILES[env.GROQ_TIER] };
  if (env.INTERVIEW_WRITER_EFFORT !== undefined) b.writerEffort = env.INTERVIEW_WRITER_EFFORT;
  if (env.INTERVIEW_DAILY_LIMIT !== undefined) b.dailyLimit = env.INTERVIEW_DAILY_LIMIT;
  if (env.INTERVIEW_QUEUE_MAX !== undefined) b.queueMax = env.INTERVIEW_QUEUE_MAX;
  if (env.INTERVIEW_MAX_REQUEST_TOKENS !== undefined)
    b.maxRequestTokens = env.INTERVIEW_MAX_REQUEST_TOKENS;
  if (env.INTERVIEW_TPM_BUDGET !== undefined) b.tpmBudget = env.INTERVIEW_TPM_BUDGET;
  if (env.INTERVIEW_DAILY_TOKENS !== undefined) b.dailyTokens = env.INTERVIEW_DAILY_TOKENS;
  if (env.INTERVIEW_JOB_TIMEOUT_MS !== undefined) b.jobTimeoutMs = env.INTERVIEW_JOB_TIMEOUT_MS;
  if (env.INTERVIEW_CONTEXT_TOKENS !== undefined) {
    b.contextTokens = env.INTERVIEW_CONTEXT_TOKENS;
    // One shard holds the whole pack on the developer tier; free shards stay at their fixed size.
    if (b.maxShards === 1) b.shardTokens = b.contextTokens;
  }

  const requests: [string, number][] = [
    ['writer', b.shardTokens + REQUEST_OVERHEAD_TOKENS + b.writerMaxOut],
    ['triage', b.triageMaxIn + b.triageMaxOut],
    ['critique', b.critiqueMaxIn + b.critiqueMaxOut],
  ];
  for (const [name, tokens] of requests)
    if (tokens > b.maxRequestTokens)
      throw new Error(
        `Interview budget: a ${name} request needs up to ${tokens} tokens but INTERVIEW_MAX_REQUEST_TOKENS is ${b.maxRequestTokens}`,
      );
  return b;
}
