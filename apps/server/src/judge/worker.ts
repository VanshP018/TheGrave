import { Worker } from 'bullmq';
import type { Logger } from 'pino';
import { scheduleBattleJob } from '../battle/queue.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import type { Executor } from './executor.js';
import { processSubmission } from './process.js';
import { SUBMISSIONS_QUEUE, type SubmissionJob } from './queue.js';

export function createJudgeWorker(executor: Executor, opts: { concurrency: number; log?: Logger }) {
  const worker = new Worker<SubmissionJob>(
    SUBMISSIONS_QUEUE,
    (job) => processSubmission(job.data.submissionId, executor),
    { connection: redis, concurrency: opts.concurrency },
  );

  worker.on('completed', (job) =>
    opts.log?.info({ submissionId: job.data.submissionId }, 'judged'),
  );
  worker.on('failed', (job, err) => {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    opts.log?.error(
      { err, submissionId: job.data.submissionId, attempt: job.attemptsMade, final },
      'judge failed',
    );
    if (final) {
      void prisma.submission
        .update({
          where: { id: job.data.submissionId },
          data: { status: 'FAILED', finishedAt: new Date() },
        })
        // A failed battle submission is no longer pending, so the battle can be decided without it.
        .then(async (s) => {
          if (s.matchId)
            await scheduleBattleJob({ type: 'judged', matchId: s.matchId, submissionId: s.id });
        })
        .catch(() => {});
    }
  });
  return worker;
}
