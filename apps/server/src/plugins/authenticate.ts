import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { verifyAccessToken } from '../lib/tokens.js';

const bearer = (req: FastifyRequest) => {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
};

/**
 * Rate-limit key per user rather than per IP. The rate-limit hook runs before route-level `authenticate`,
 * so the token is verified here too; unauthenticated requests fall back to the IP (and are then rejected).
 */
export function userRateLimitKey(req: FastifyRequest): string {
  const token = bearer(req);
  if (token) {
    try {
      return `u:${verifyAccessToken(token).sub}`;
    } catch {
      // fall through
    }
  }
  return req.ip;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    auth: { userId: string; username: string } | null;
  }
}

export default fp(async (app) => {
  app.decorateRequest('auth', null);
  // Use as `onRequest: app.authenticate` on protected routes.
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = bearer(req);
    if (!token)
      return reply.code(401).send({ error: 'Unauthorized', message: 'Missing access token' });
    try {
      const claims = verifyAccessToken(token);
      req.auth = { userId: claims.sub, username: claims.username };
    } catch {
      return reply
        .code(401)
        .send({ error: 'Unauthorized', message: 'Invalid or expired access token' });
    }
  });
});
