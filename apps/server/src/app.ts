import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { ApiError } from '@thegrave/shared';
import { config } from './config.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { authRoutes } from './modules/auth/routes.js';
import { AuthError } from './modules/auth/service.js';
import authenticate from './plugins/authenticate.js';

export async function buildApp() {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty' } }
        : config.NODE_ENV !== 'test',
  });

  await app.register(helmet);
  await app.register(cors, { origin: config.CORS_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute', redis, nameSpace: 'rl:' });
  await app.register(authenticate);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const body: ApiError = {
        error: 'Bad Request',
        message: 'Validation failed',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
      return reply.code(400).send(body);
    }
    if (err instanceof AuthError) {
      return reply.code(err.statusCode).send({
        error: err.statusCode === 401 ? 'Unauthorized' : 'Conflict',
        message: err.message,
      });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send({
      error: status >= 500 ? 'Internal Server Error' : (err as Error).name,
      message: status >= 500 ? 'Something went wrong' : (err as Error).message,
    });
  });

  app.get('/health', async (_req, reply) => {
    const [db, cache] = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redis.ping()]);
    const ok = db.status === 'fulfilled' && cache.status === 'fulfilled';
    return reply.code(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      postgres: db.status === 'fulfilled',
      redis: cache.status === 'fulfilled',
    });
  });

  // All client-facing routes live under /api so paths (and the refresh cookie's Path) are identical
  // behind the Vite dev proxy and the production reverse proxy. /health stays at the root for probes.
  await app.register(authRoutes, { prefix: '/api' });

  return app;
}
