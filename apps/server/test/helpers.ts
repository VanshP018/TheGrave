import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { redis } from '../src/lib/redis.js';
import { REFRESH_COOKIE } from '../src/modules/auth/routes.js';

export async function setupApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

export async function resetState() {
  await prisma.$executeRawUnsafe('TRUNCATE "RefreshToken", "User" CASCADE');
  await redis.flushdb();
}

export async function closeAll(app: FastifyInstance) {
  await app.close();
  await Promise.all([prisma.$disconnect(), redis.quit()]);
}

export function refreshCookie(res: LightMyRequestResponse) {
  return res.cookies.find((c) => c.name === REFRESH_COOKIE);
}

export const alice = {
  username: 'alice',
  email: 'alice@example.com',
  password: 'correct-horse-battery',
};
