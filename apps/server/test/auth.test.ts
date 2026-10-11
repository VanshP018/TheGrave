import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { hashRefreshToken } from '../src/lib/tokens.js';
import { alice, closeAll, refreshCookie, resetState, setupApp } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await setupApp();
});
afterAll(() => closeAll(app));
beforeEach(resetState);

const register = (body: object = alice) =>
  app.inject({ method: 'POST', url: '/api/auth/register', payload: body });
const login = (body: object) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: body });
const refresh = (token?: string) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/refresh',
    cookies: token ? { tg_refresh: token } : {},
  });
const me = (accessToken: string) =>
  app.inject({
    method: 'GET',
    url: '/api/me',
    headers: { authorization: `Bearer ${accessToken}` },
  });

describe('register', () => {
  it('creates a user, returns an access token and sets a hardened refresh cookie', async () => {
    const res = await register();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toMatchObject({
      username: 'alice',
      email: 'alice@example.com',
      rating: 1500,
    });
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.user).not.toHaveProperty('passwordHash');

    const cookie = refreshCookie(res)!;
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/api/auth',
    });

    const row = await prisma.user.findUniqueOrThrow({ where: { email: 'alice@example.com' } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    // Only the hash of the refresh token is stored.
    const stored = await prisma.refreshToken.findFirstOrThrow({ where: { userId: row.id } });
    expect(stored.tokenHash).toBe(hashRefreshToken(cookie.value));
    expect(stored.tokenHash).not.toBe(cookie.value);
  });

  it('normalises email case and rejects duplicates with 409', async () => {
    await register();
    const dupEmail = await register({
      ...alice,
      username: 'alice2',
      email: '  ALICE@example.com ',
    });
    expect(dupEmail.statusCode).toBe(409);
    const dupName = await register({ ...alice, email: 'other@example.com' });
    expect(dupName.statusCode).toBe(409);
  });

  it('rejects invalid input with 400 and field-level issues', async () => {
    const res = await register({ username: 'a!', email: 'nope', password: 'short' });
    expect(res.statusCode).toBe(400);
    const paths = res.json().issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['username', 'email', 'password']));
  });
});

describe('login', () => {
  beforeEach(async () => {
    await register();
  });

  it('logs in with correct credentials', async () => {
    const res = await login({ email: alice.email, password: alice.password });
    expect(res.statusCode).toBe(200);
    expect(refreshCookie(res)?.value).toBeTruthy();
    expect((await me(res.json().accessToken)).json().username).toBe('alice');
  });

  it('returns the same generic error for a wrong password and an unknown email', async () => {
    const wrongPw = await login({ email: alice.email, password: 'wrong-password' });
    const noUser = await login({ email: 'ghost@example.com', password: 'wrong-password' });
    expect(wrongPw.statusCode).toBe(401);
    expect(noUser.statusCode).toBe(401);
    expect(wrongPw.json()).toEqual(noUser.json());
  });

  it('rate limits to 5 attempts per minute per IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++)
      codes.push((await login({ email: alice.email, password: 'wrong' })).statusCode);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429]);
  });
});

describe('refresh', () => {
  it('rotates the refresh token on every use', async () => {
    const t0 = refreshCookie(await register())!.value;

    const r1 = await refresh(t0);
    expect(r1.statusCode).toBe(200);
    const t1 = refreshCookie(r1)!.value;
    expect(t1).not.toBe(t0);
    expect((await me(r1.json().accessToken)).statusCode).toBe(200);

    const r2 = await refresh(t1);
    expect(r2.statusCode).toBe(200);
    expect(refreshCookie(r2)!.value).not.toBe(t1);

    // All rotations stay in one family; only the newest is live.
    const rows = await prisma.refreshToken.findMany();
    expect(new Set(rows.map((r) => r.familyId)).size).toBe(1);
    expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1);
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const t0 = refreshCookie(await register())!.value;
    const t1 = refreshCookie(await refresh(t0))!.value;

    // Attacker replays the stolen, already-rotated t0.
    const replay = await refresh(t0);
    expect(replay.statusCode).toBe(401);

    // The legitimate holder's newer token is now dead too.
    expect((await refresh(t1)).statusCode).toBe(401);
    const live = await prisma.refreshToken.count({ where: { revokedAt: null } });
    expect(live).toBe(0);
  });

  it('does not revoke other login sessions of the same user on reuse', async () => {
    const a0 = refreshCookie(await register())!.value;
    const b0 = refreshCookie(await login({ email: alice.email, password: alice.password }))!.value;
    await refresh(a0);
    await refresh(a0); // reuse in family A
    expect((await refresh(b0)).statusCode).toBe(200);
  });

  it('rejects missing, unknown and expired tokens', async () => {
    expect((await refresh()).statusCode).toBe(401);
    expect((await refresh('not-a-real-token')).statusCode).toBe(401);

    const t0 = refreshCookie(await register())!.value;
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await refresh(t0);
    expect(res.statusCode).toBe(401);
    // Cookie is cleared on failure.
    expect(refreshCookie(res)?.value).toBe('');
  });

  it('lets only one of two concurrent refreshes with the same token win', async () => {
    const t0 = refreshCookie(await register())!.value;
    const results = await Promise.all([refresh(t0), refresh(t0)]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toContain(401);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBeLessThanOrEqual(1);
  });
});

describe('logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const t0 = refreshCookie(await register())!.value;
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { tg_refresh: t0 },
    });
    expect(res.statusCode).toBe(204);
    expect(refreshCookie(res)?.value).toBe('');
    expect((await refresh(t0)).statusCode).toBe(401);
  });

  it('is idempotent without a cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(204);
  });
});

describe('GET /me', () => {
  it('requires a valid bearer token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    expect((await me('garbage')).statusCode).toBe(401);
  });

  it('rejects tokens signed with another secret, alg=none, or expired', async () => {
    const { user } = (await register()).json();
    const forged = jwt.sign({ username: 'alice' }, 'x'.repeat(40), {
      subject: user.id,
      issuer: 'thegrave',
    });
    const none = jwt.sign({ username: 'alice' }, '', {
      algorithm: 'none',
      subject: user.id,
      issuer: 'thegrave',
    });
    const expired = jwt.sign({ username: 'alice' }, process.env.JWT_ACCESS_SECRET!, {
      subject: user.id,
      issuer: 'thegrave',
      expiresIn: -10,
    });
    for (const t of [forged, none, expired]) expect((await me(t)).statusCode).toBe(401);
  });
});
