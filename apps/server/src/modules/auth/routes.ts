import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  loginSchema,
  registerSchema,
  resendCodeSchema,
  verifyEmailSchema,
  type AuthResponse,
} from '@thegrave/shared';
import { config } from '../../config.js';
import * as pending from './pending.js';
import * as auth from './service.js';

export const REFRESH_COOKIE = 'tg_refresh';
// Scoped to the auth routes so the refresh token never rides along on other requests.
const COOKIE_PATH = '/api/auth';

function sendTokens(reply: FastifyReply, issued: auth.IssuedTokens, status = 200) {
  reply.setCookie(REFRESH_COOKIE, issued.refreshToken, {
    httpOnly: true,
    secure: config.NODE_ENV !== 'development',
    sameSite: 'strict',
    path: COOKIE_PATH,
    expires: issued.refreshExpiresAt,
  });
  const body: AuthResponse = { accessToken: issued.accessToken, user: issued.user };
  return reply.code(status).send(body);
}

function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
}

const limit = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute' } });

export async function authRoutes(app: FastifyInstance) {
  // Registration is three steps (decision.md D-076): start (emails a code), verify (creates the account), resend.
  app.post('/auth/register', { config: limit(5) }, async (req, reply) => {
    const started = await pending.startRegistration(registerSchema.parse(req.body));
    return reply.code(202).send(started);
  });

  app.post('/auth/register/verify', { config: limit(10) }, async (req, reply) => {
    const { email, code } = verifyEmailSchema.parse(req.body);
    return sendTokens(reply, await pending.verifyRegistration(email, code), 201);
  });

  app.post('/auth/register/resend', { config: limit(5) }, async (req, reply) => {
    const started = await pending.resendCode(resendCodeSchema.parse(req.body).email);
    return reply.code(202).send(started);
  });

  app.post('/auth/login', { config: limit(5) }, async (req, reply) => {
    const issued = await auth.login(loginSchema.parse(req.body));
    return sendTokens(reply, issued);
  });

  app.post('/auth/refresh', { config: limit(30) }, async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) return reply.code(401).send({ error: 'Unauthorized', message: 'No session' });
    try {
      return sendTokens(reply, await auth.refresh(token));
    } catch (err) {
      clearRefreshCookie(reply);
      throw err;
    }
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (token) await auth.logout(token);
    clearRefreshCookie(reply);
    return reply.code(204).send();
  });

  app.get('/me', { onRequest: app.authenticate }, async (req, reply) => {
    const user = await auth.getUser(req.auth!.userId);
    if (!user)
      return reply.code(401).send({ error: 'Unauthorized', message: 'User no longer exists' });
    return user;
  });
}
