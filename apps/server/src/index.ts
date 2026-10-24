import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { attachRealtime } from './realtime/index.js';

const app = await buildApp();
attachRealtime(app);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await Promise.all([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
};
// A crash should be loud and restart cleanly (the orchestrator restarts the process), not limp on.
process.on('unhandledRejection', (err) => {
  app.log.fatal({ err }, 'unhandled rejection');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  app.log.fatal({ err }, 'uncaught exception');
  process.exit(1);
});
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: '0.0.0.0' });
