import type { Config } from '../config.js';
import { redis } from '../lib/redis.js';
import type { TierBudget } from './budget.js';
import { FakeInterviewLlm } from './fake-llm.js';
import { interviewGroqKey } from './enabled.js';
import { GroqClient } from './groq-client.js';
import { GroqInterviewLlm } from './groq-llm.js';
import type { InterviewLlm, InterviewLogger } from './llm.js';
import { GroqLimiter } from './rate-limit.js';

type LlmEnv = Pick<
  Config,
  | 'INTERVIEW_MODEL'
  | 'INTERVIEW_TRIAGE_MODEL'
  | 'INTERVIEW_CRITIQUE_MODEL'
  | 'INTERVIEW_JSON_MODE'
  | 'INTERVIEW_GROQ_API_KEY'
  | 'GROQ_API_KEY'
  | 'GROQ_BASE_URL'
>;

/** The production LLM: Groq (shared Redis limiter), the deterministic fake for INTERVIEW_MODEL=fake, null if no key. */
export function createInterviewLlm(
  env: LlmEnv,
  budget: TierBudget,
  log?: InterviewLogger,
): InterviewLlm | null {
  if (env.INTERVIEW_MODEL === 'fake') return new FakeInterviewLlm(budget);
  // Same key resolution as interviewsEnabled(): the override, else the hint coach's GROQ_API_KEY.
  const apiKey = interviewGroqKey(env);
  if (!apiKey) return null;
  const client = new GroqClient({
    apiKey,
    baseUrl: env.GROQ_BASE_URL,
    // The limiter keeps its own Redis keys (interviews:groq:*), but when this runs on the coach's GROQ_API_KEY the
    // key's Groq-side limits (TPM/RPM/TPD per model) are shared with the hint coach, which does not use the limiter.
    limiter: new GroqLimiter(redis, {
      tpm: budget.tpmBudget,
      rpm: budget.rpmBudget,
      dailyTokens: budget.dailyTokens,
    }),
    log,
  });
  return new GroqInterviewLlm(client, {
    budget,
    models: {
      writer: env.INTERVIEW_MODEL,
      triage: env.INTERVIEW_TRIAGE_MODEL,
      critique: env.INTERVIEW_CRITIQUE_MODEL,
    },
    jsonMode: env.INTERVIEW_JSON_MODE,
    log,
  });
}
