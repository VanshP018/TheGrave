import { Queue } from 'bullmq';
import { redis } from '../lib/redis.js';

export const WORKSPACE_QUEUE = 'workspace-runs';

export interface WorkspaceJob {
  runId: string;
}

export const workspaceQueue = new Queue<WorkspaceJob>(WORKSPACE_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    // Like the judge: retries cover infrastructure errors only; failing tests are results, not exceptions.
    attempts: 2,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export const enqueueWorkspaceRun = (runId: string) =>
  workspaceQueue.add('run', { runId }, { jobId: runId });
