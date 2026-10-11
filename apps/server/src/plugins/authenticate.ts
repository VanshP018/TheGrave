import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { verifyAccessToken } from '../lib/tokens.js';

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
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
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
