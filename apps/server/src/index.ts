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
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.PORT, host: '0.0.0.0' });
