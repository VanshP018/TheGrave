import { DelayedError, Worker } from 'bullmq';
import type { Logger } from 'pino';
import { InterviewError } from './errors.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { processInterview, type ProcessDeps } from './process.js';
import { INTERVIEWS_QUEUE, type InterviewJob } from './queue.js';

export function createInterviewWorker(
  deps: ProcessDeps,
  opts: { concurrency: number; log?: Logger },
) {
  const worker = new Worker<InterviewJob>(
    INTERVIEWS_QUEUE,
    async (job, token) => {
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      const out = await processInterview(
        job.data.analysisId,
        { log: opts.log, ...deps },
        { final },
      );
      if (out.kind === 'delayed') {
        // The AI is busy: park the job until it should be free again; the row is QUEUED meanwhile.
        await job.moveToDelayed(out.until.getTime(), token);
        throw new DelayedError();
      }
    },
    { connection: redis, concurrency: opts.concurrency },
  );
  worker.on('failed', (job, err) => {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    opts.log?.error({ err, analysisId: job.data.analysisId, final }, 'interview job failed');
    if (final)
      void prisma.interviewAnalysis
        .updateMany({
          where: { id: job.data.analysisId, status: { notIn: ['DONE', 'FAILED'] } },
          data: {
            status: 'FAILED',
            stage: 'QUEUED',
            errorCode: err instanceof InterviewError ? err.code : 'INTERNAL',
            finishedAt: new Date(),
          },
        })
        .catch(() => {});
  });
  return worker;
}
