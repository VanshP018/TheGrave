// Judge worker entrypoint. Needs Docker access, so in production it runs on dedicated judge hosts,
// never on API nodes (decision.md D-008).
import { pino } from 'pino';
import { config } from './config.js';
import { DockerExecutor } from './judge/docker-executor.js';
import { createJudgeWorker } from './judge/worker.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { WorkspaceExecutor } from './workspace/executor.js';
import { createWorkspaceWorker } from './workspace/worker.js';

const log = pino(config.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {});
const executor = new DockerExecutor({ image: config.JUDGE_IMAGE, runtime: config.JUDGE_RUNTIME });
const worker = createJudgeWorker(executor, { concurrency: config.JUDGE_CONCURRENCY, log });
log.info(
  { concurrency: config.JUDGE_CONCURRENCY, image: config.JUDGE_IMAGE },
  'judge worker started',
);
const workspace = createWorkspaceWorker(
  new WorkspaceExecutor({ image: config.WORKSPACE_IMAGE, runtime: config.JUDGE_RUNTIME }),
  { concurrency: config.WORKSPACE_CONCURRENCY, log },
);
log.info(
  { concurrency: config.WORKSPACE_CONCURRENCY, image: config.WORKSPACE_IMAGE },
  'workspace worker started',
);

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutting down; waiting for active jobs');
  await Promise.all([worker.close(), workspace.close()]);
  await Promise.all([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
