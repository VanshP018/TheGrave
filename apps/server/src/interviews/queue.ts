import { Queue } from 'bullmq';
import { redis } from '../lib/redis.js';

export const INTERVIEWS_QUEUE = 'interviews';

export interface InterviewJob {
  analysisId: string;
}

export const interviewsQueue = new Queue<InterviewJob>(INTERVIEWS_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    // Retries cover infrastructure errors (GitHub/Groq down); user-caused failures are results, not exceptions.
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 2000 },
  },
});

/** jobId = analysis id, so enqueueing the same analysis twice is a no-op. */
export const enqueueInterview = (analysisId: string) =>
  interviewsQueue.add('analyse', { analysisId }, { jobId: analysisId });
