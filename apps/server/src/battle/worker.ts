import { Worker } from 'bullmq';
import { redis } from '../lib/redis.js';
import { BATTLE_QUEUE, type BattleJob } from './queue.js';
import type { BattleService } from './service.js';

/** Runs inside every API node (it needs Socket.IO to notify players); any node may take any job. */
export const createBattleWorker = (battle: BattleService) =>
  new Worker<BattleJob>(BATTLE_QUEUE, (job) => battle.handle(job.data), {
    connection: redis,
    concurrency: 20,
  });
