import { Queue, Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import { materialiseRdDecay, type Leaderboard } from './leaderboard.js';

const QUEUE = 'maintenance';

/**
 * Periodic RD decay + leaderboard reconcile, and a rebuild on boot (decision.md D-049, D-050).
 * The job scheduler is keyed by id, so every API node calling this still yields one schedule.
 */
export async function startRatingMaintenance(
  leaderboard: Leaderboard,
  opts: { everyMs?: number; log?: { info: (obj: object, msg: string) => void } } = {},
) {
  const queue = new Queue(QUEUE, { connection: redis });
  await queue.upsertJobScheduler(
    'rd-decay',
    { every: opts.everyMs ?? 60 * 60 * 1000 },
    { name: 'rd-decay', opts: { removeOnComplete: 100, removeOnFail: 100 } },
  );
  const worker = new Worker(
    QUEUE,
    async () => {
      const decayed = await materialiseRdDecay();
      const { members } = await leaderboard.rebuild();
      opts.log?.info({ decayed, members }, 'rating maintenance');
    },
    { connection: redis, concurrency: 1 },
  );
  // Redis is derived state: whatever it holds after a restart or flush, Postgres wins.
  await leaderboard.rebuild();
  return {
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
