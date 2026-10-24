import { Worker } from 'bullmq';
import type { Logger } from 'pino';
import { scheduleBattleJob } from '../battle/queue.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import type { WorkspaceRunner } from './executor.js';
import { processProjectRun } from './process.js';
import { WORKSPACE_QUEUE, type WorkspaceJob } from './queue.js';

export function createWorkspaceWorker(
  runner: WorkspaceRunner,
  opts: { concurrency: number; log?: Logger },
) {
  const worker = new Worker<WorkspaceJob>(
    WORKSPACE_QUEUE,
    (job) => processProjectRun(job.data.runId, runner),
    { connection: redis, concurrency: opts.concurrency },
  );
  worker.on('failed', (job, err) => {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    opts.log?.error({ err, runId: job.data.runId, final }, 'workspace run failed');
    if (final)
      void prisma.projectRun
        .update({
          where: { id: job.data.runId },
          data: { status: 'FAILED', finishedAt: new Date() },
        })
        // A failed battle run is no longer pending, so the battle can be decided without it.
        .then(async (r) => {
          if (r.matchId)
            await scheduleBattleJob({ type: 'judged', matchId: r.matchId, submissionId: r.id });
        })
        .catch(() => {});
  });
  return worker;
}
