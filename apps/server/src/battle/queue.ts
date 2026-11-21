import { Queue } from 'bullmq';
import { redis } from '../lib/redis.js';

export const BATTLE_QUEUE = 'battle';

/** Every battle timer is a delayed job, so timers survive restarts and run on whichever API node is free. */
export type BattleJob =
  | { type: 'start'; matchId: string }
  | { type: 'end'; matchId: string; attempt: number }
  | { type: 'judged'; matchId: string; submissionId: string }
  | { type: 'forfeit'; matchId: string; userId: string; token: string }
  /** A practice bot's scripted submission (see src/bots/plan.ts). */
  | { type: 'bot'; matchId: string; botId: string; seq: number; passed: number; total: number }
  /** A practice bot answering a draw offer. */
  | { type: 'botdraw'; matchId: string; botId: string };

export const battleQueue = new Queue<BattleJob>(BATTLE_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 500 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

/** Job ids make scheduling idempotent (BullMQ ids may not contain ':'). */
export function scheduleBattleJob(job: BattleJob, delayMs = 0) {
  const id =
    job.type === 'start'
      ? `start_${job.matchId}`
      : job.type === 'end'
        ? `end_${job.matchId}_${job.attempt}`
        : job.type === 'judged'
          ? `judged_${job.submissionId}`
          : job.type === 'bot'
            ? `bot_${job.matchId}_${job.botId}_${job.seq}`
            : job.type === 'botdraw'
              ? `botdraw_${job.matchId}_${Date.now()}`
              : `forfeit_${job.matchId}_${job.userId}_${job.token}`;
  return battleQueue.add(job.type, job, { jobId: id, delay: Math.max(0, delayMs) });
}
