// Interview worker entrypoint: fetches public GitHub repos as text and calls Groq. It needs no Docker socket, so
// it runs as its own process (plan.md 3.2), never inside the judge worker or API nodes.
import { pino } from 'pino';
import { config } from './config.js';
import { resolveBudget } from './interviews/budget.js';
import { createInterviewLlm } from './interviews/create-llm.js';
import { GitHubRepoSource } from './interviews/github.js';
import { interviewsQueue } from './interviews/queue.js';
import { TreeCachedSource } from './interviews/tree-cache.js';
import { createInterviewWorker } from './interviews/worker.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';

const log = pino(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {});
const budget = resolveBudget(config); // throws on a bad combination: fail fast instead of 413s
const llm = createInterviewLlm(config, budget, log);

const worker = llm
  ? createInterviewWorker(
      {
        source: new TreeCachedSource(
          new GitHubRepoSource({
            token: config.GITHUB_TOKEN,
            maxRepoMb: config.INTERVIEW_MAX_REPO_MB,
          }),
          redis,
        ),
        llm,
        budget,
        log,
      },
      { concurrency: config.INTERVIEW_CONCURRENCY, log },
    )
  : null;
// Without a key the API answers 503 "not set up"; stay up but idle so the container does not restart-loop.
if (worker)
  log.info(
    { concurrency: config.INTERVIEW_CONCURRENCY, tier: budget.tier, model: config.INTERVIEW_MODEL },
    'interview worker started',
  );
else log.warn('no Groq key (GROQ_API_KEY or INTERVIEW_GROQ_API_KEY): interview worker is idle');

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down; waiting for active jobs');
  await worker?.close();
  await Promise.all([interviewsQueue.close(), prisma.$disconnect(), redis.quit()]);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
