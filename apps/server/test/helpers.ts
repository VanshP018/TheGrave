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
  await prisma.$executeRawUnsafe('TRUNCATE "RefreshToken", "User", "Problem", "Project" CASCADE');
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
  institution: 'Test University',
};

/** Newest emailed code for an address, read from the test outbox (OutboxMailer). */
export async function latestCode(email: string): Promise<string> {
  for (const raw of await redis.lrange('test:outbox', 0, -1)) {
    const msg = JSON.parse(raw) as { to: string; text: string };
    if (msg.to === email) return /\b(\d{6})\b/.exec(msg.text)![1]!;
  }
  throw new Error(`No email for ${email} in the outbox`);
}

/** Registers a user through the full email-code flow and returns a bearer header for them. */
export async function registerUser(app: FastifyInstance, username: string) {
  const email = `${username}@example.com`;
  await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      username,
      email,
      password: 'correct-horse-battery',
      institution: 'Test University',
    },
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register/verify',
    payload: { email, code: await latestCode(email) },
  });
  return { authorization: `Bearer ${res.json().accessToken as string}` };
}
