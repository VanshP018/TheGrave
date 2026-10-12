import { Queue } from 'bullmq';
import { redis } from '../lib/redis.js';

export const SUBMISSIONS_QUEUE = 'submissions';

export interface SubmissionJob {
  submissionId: string;
}

export const submissionsQueue = new Queue<SubmissionJob>(SUBMISSIONS_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    // Retries only cover judge infrastructure errors; user-code failures are verdicts, not exceptions.
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export const enqueueSubmission = (submissionId: string) =>
  // jobId = submissionId makes enqueueing idempotent.
  submissionsQueue.add('judge', { submissionId }, { jobId: submissionId });
