import { afterAll, describe, expect, it } from 'vitest';
import { resolveBudget } from '../src/interviews/budget.js';
import { totalCostMicroUsd } from '../src/interviews/cost.js';
import { GroqClient } from '../src/interviews/groq-client.js';
import { GroqInterviewLlm } from '../src/interviews/groq-llm.js';
import { runPipeline } from '../src/interviews/pipeline.js';
import { GroqLimiter } from '../src/interviews/rate-limit.js';
import { MemoryRepoSource } from '../src/interviews/source.js';
import { redis } from '../src/lib/redis.js';
import { expressApi } from './fixtures/interview-repos.js';
import { ref } from './fixtures/interview-setup.js';

// Live smoke test against the real Groq API. Never runs in CI: it needs INTERVIEW_LIVE_TEST=1 and GROQ_API_KEY.
//
//   INTERVIEW_LIVE_TEST=1 GROQ_API_KEY=gsk_... [GROQ_TIER=free|developer] pnpm --filter @thegrave/server exec vitest run test/interviews-live
//
// Cost: about $0.02 per run on the developer tier; $0 on the free tier, but it spends ~45k of the day's 200k tokens
// per model. Free tier runs are paced by the limiter (~1 writer call a minute), so the timeout is 15 minutes.
//
// To check by hand (plan.md task 3.4): whether Groq counts max_completion_tokens against TPM, compare
// `x-ratelimit-remaining-tokens` before and after one call and adjust the reservation formula if it does not.

const enabled = Boolean(process.env.INTERVIEW_LIVE_TEST && process.env.GROQ_API_KEY);
const tier = process.env.GROQ_TIER === 'free' ? 'free' : 'developer';

afterAll(async () => {
  await redis.quit();
});

describe.skipIf(!enabled)('live Groq pipeline', () => {
  it(
    'writes verified questions for the express fixture',
    async () => {
      const budget = resolveBudget({
        GROQ_TIER: tier,
        INTERVIEW_WRITER_EFFORT: undefined,
        INTERVIEW_DAILY_LIMIT: undefined,
        INTERVIEW_QUEUE_MAX: undefined,
        INTERVIEW_MAX_REQUEST_TOKENS: undefined,
        INTERVIEW_CONTEXT_TOKENS: undefined,
        INTERVIEW_TPM_BUDGET: undefined,
        INTERVIEW_DAILY_TOKENS: undefined,
        INTERVIEW_JOB_TIMEOUT_MS: undefined,
      });
      const log = {
        info: (o: object, m?: string) => console.log(m, JSON.stringify(o)),
        warn: (o: object, m?: string) => console.warn(m, JSON.stringify(o)),
      };
      const waits: Date[] = [];
      const client = new GroqClient({
        apiKey: process.env.GROQ_API_KEY!,
        baseUrl: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
        limiter: new GroqLimiter(
          redis,
          { tpm: budget.tpmBudget, rpm: budget.rpmBudget, dailyTokens: budget.dailyTokens },
          Date.now,
          'test:live:groq',
        ),
        log,
      });
      const llm = new GroqInterviewLlm(client, {
        budget,
        models: {
          writer: 'openai/gpt-oss-120b',
          triage: 'openai/gpt-oss-20b',
          critique: 'openai/gpt-oss-20b',
        },
        log,
      });
      const result = await runPipeline(
        {
          source: new MemoryRepoSource(expressApi, { description: 'Orders service' }),
          llm,
          budget,
          log,
          onStage: (s, d) => console.log('stage', s, d),
          onWait: (until) => waits.push(until),
        },
        ref,
        'AUTO',
        AbortSignal.timeout(budget.jobTimeoutMs),
      );

      expect(result.questions.length).toBeGreaterThanOrEqual(5);
      for (const q of result.questions)
        for (const e of q.evidence)
          expect(e.snippet).toBe(
            (expressApi[e.path] as string)
              .split('\n')
              .slice(e.startLine - 1, e.endLine)
              .join('\n'),
          );
      console.log('usage', JSON.stringify(result.usage));
      console.log(
        'cached tokens',
        result.usage.reduce((n, u) => n + u.cachedInputTokens, 0),
      );
      console.log('cost micro-USD', totalCostMicroUsd(result.usage));
      console.log('limiter waits', waits.length);
      console.log('metrics', JSON.stringify(result.metrics));
    },
    15 * 60_000,
  );
});

describe.skipIf(enabled)('live Groq pipeline (skipped)', () => {
  it.skip('needs INTERVIEW_LIVE_TEST=1 and GROQ_API_KEY', () => {});
});
