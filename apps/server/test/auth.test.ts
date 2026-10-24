import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { hashRefreshToken } from '../src/lib/tokens.js';
import { redis } from '../src/lib/redis.js';
import { alice, closeAll, latestCode, refreshCookie, resetState, setupApp } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await setupApp();
});
afterAll(() => closeAll(app));
beforeEach(resetState);

const start = (body: object = alice) =>
  app.inject({ method: 'POST', url: '/api/auth/register', payload: body });
const verify = (email: string, code: string) =>
  app.inject({ method: 'POST', url: '/api/auth/register/verify', payload: { email, code } });
const resend = (email: string) =>
  app.inject({ method: 'POST', url: '/api/auth/register/resend', payload: { email } });
/** The whole flow: start, read the emailed code, verify. Resolves to the verify response. */
const register = async (body: { email: string } = alice) => {
  await start(body);
  return verify(body.email.trim().toLowerCase(), await latestCode(body.email.trim().toLowerCase()));
};
const wrongCode = async (email: string) => {
  const real = await latestCode(email);
  return real === '000000' ? '000001' : '000000';
};
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
  it('starts with 202, emails a code and creates no user until verified', async () => {
    const res = await start();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.email).toBe('alice@example.com');
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    expect(body.resendAvailableAt).toBeGreaterThan(Date.now());
    expect(body).not.toHaveProperty('accessToken');
    expect(refreshCookie(res)).toBeUndefined();
    expect(await prisma.user.count()).toBe(0);
    expect(await latestCode(alice.email)).toMatch(/^\d{6}$/);
    // The code is stored hashed, never in the clear.
    const pending = await redis.hgetall('reg:pending:alice@example.com');
    expect(pending.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pending.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('verify creates the user, returns an access token and sets a hardened refresh cookie', async () => {
    const res = await register();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toMatchObject({
      username: 'alice',
      email: 'alice@example.com',
      institution: 'Test University',
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
    expect(row.emailVerifiedAt).toBeInstanceOf(Date);
    // Only the hash of the refresh token is stored.
    const stored = await prisma.refreshToken.findFirstOrThrow({ where: { userId: row.id } });
    expect(stored.tokenHash).toBe(hashRefreshToken(cookie.value));
    expect(stored.tokenHash).not.toBe(cookie.value);
    // Pending state and the username reservation are gone.
    expect(await redis.exists('reg:pending:alice@example.com', 'reg:username:alice')).toBe(0);
    // The registered password works for login.
    expect((await login({ email: alice.email, password: alice.password })).statusCode).toBe(200);
  });

  it('stores the trimmed institution and returns it from /me', async () => {
    const res = await register({ ...alice, institution: '  IIT Delhi  ' } as typeof alice);
    expect(res.json().user.institution).toBe('IIT Delhi');
    expect((await me(res.json().accessToken)).json().institution).toBe('IIT Delhi');
  });

  it('requires an institution of 2-100 characters', async () => {
    const { username, email, password } = alice;
    for (const body of [
      { username, email, password },
      { ...alice, institution: ' a ' },
      { ...alice, institution: 'x'.repeat(101) },
    ]) {
      const res = await start(body);
      expect(res.statusCode).toBe(400);
      expect(res.json().issues.map((i: { path: string }) => i.path)).toContain('institution');
    }
  });

  it('normalises email case and rejects duplicates with 409 at start', async () => {
    await register();
    const dupEmail = await start({ ...alice, username: 'alice2', email: '  ALICE@example.com ' });
    expect(dupEmail.statusCode).toBe(409);
    const dupName = await start({ ...alice, email: 'other@example.com' });
    expect(dupName.statusCode).toBe(409);
  });

  it('reserves the username for another email while a registration is pending', async () => {
    expect((await start()).statusCode).toBe(202);
    const rival = await start({ ...alice, email: 'rival@example.com', username: 'ALICE' });
    expect(rival.statusCode).toBe(409);
    expect(rival.json().message).toBe('Username is taken');
    // The same email may restart with the same name.
    expect((await start()).statusCode).toBe(202);
  });

  it('rejects invalid input with 400 and field-level issues', async () => {
    const res = await start({ username: 'a!', email: 'nope', password: 'short' });
    expect(res.statusCode).toBe(400);
    const paths = res.json().issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['username', 'email', 'password', 'institution']));
  });
});

describe('verify', () => {
  it('answers a wrong code with 400 and the attempts left', async () => {
    await start();
    const bad = await wrongCode(alice.email);
    const res = await verify(alice.email, bad);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ message: 'Incorrect code', attemptsLeft: 4 });
    expect(await prisma.user.count()).toBe(0);
    // The right code still works afterwards.
    expect((await verify(alice.email, await latestCode(alice.email))).statusCode).toBe(201);
  });

  it('kills the pending registration after 5 wrong codes', async () => {
    await start();
    const good = await latestCode(alice.email);
    const bad = await wrongCode(alice.email);
    const lefts: number[] = [];
    for (let i = 0; i < 5; i++) lefts.push((await verify(alice.email, bad)).json().attemptsLeft);
    expect(lefts).toEqual([4, 3, 2, 1, 0]);
    // Even the right code is useless now; the username is free again.
    const res = await verify(alice.email, good);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Code expired or not found');
    expect(await redis.exists('reg:pending:alice@example.com', 'reg:username:alice')).toBe(0);
    expect((await start({ ...alice, email: 'other@example.com' })).statusCode).toBe(202);
  });

  it('answers unknown or expired registrations with 400', async () => {
    const res = await verify('ghost@example.com', '123456');
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Code expired or not found');

    await start();
    await redis.del('reg:pending:alice@example.com');
    expect((await verify(alice.email, '123456')).statusCode).toBe(400);
  });

  it('rejects malformed codes with 400', async () => {
    await start();
    for (const code of ['12345', '1234567', 'abcdef', '12 456']) {
      expect((await verify(alice.email, code)).statusCode).toBe(400);
    }
  });
});

describe('resend', () => {
  it('404s without a pending registration', async () => {
    expect((await resend('ghost@example.com')).statusCode).toBe(404);
  });

  it('429s with Retry-After during the cooldown', async () => {
    await start();
    const res = await resend(alice.email);
    expect(res.statusCode).toBe(429);
    expect(res.json().retryAfterMs).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('issues a new code after the cooldown and the old one stops working', async () => {
    await start();
    const oldCode = await latestCode(alice.email);
    await redis.hset('reg:pending:alice@example.com', 'resendAt', Date.now() - 1);
    const res = await resend(alice.email);
    expect(res.statusCode).toBe(202);
    expect(res.json().resendAvailableAt).toBeGreaterThan(Date.now());
    const newCode = await latestCode(alice.email);
    if (newCode !== oldCode) {
      const bad = await verify(alice.email, oldCode);
      expect(bad.statusCode).toBe(400);
      expect(bad.json().attemptsLeft).toBe(4);
    }
    expect((await verify(alice.email, newCode)).statusCode).toBe(201);
  });

  it('caps a pending registration at 5 codes', async () => {
    await start();
    for (let i = 0; i < 4; i++) {
      await redis.hset('reg:pending:alice@example.com', 'resendAt', Date.now() - 1);
      expect((await resend(alice.email)).statusCode).toBe(202);
    }
    await redis.hset('reg:pending:alice@example.com', 'resendAt', Date.now() - 1);
    const res = await resend(alice.email);
    expect(res.statusCode).toBe(429);
    expect(res.json().message).toBe('Too many codes requested, start again later');
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

  it('caps codes per email per hour, even across restarts', async () => {
    // Clear the per-IP route limiter each time so only the per-email budget is under test.
    const start = async (n: number) => {
      const rl = await redis.keys('rl:*');
      if (rl.length) await redis.del(...rl);
      return app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          username: `flood${n}`,
          email: 'flood@example.com',
          password: 'correct-horse-battery',
          institution: 'Test University',
        },
      });
    };
    for (let i = 0; i < 10; i++) expect((await start(i)).statusCode).toBe(202);
    const eleventh = await start(10);
    expect(eleventh.statusCode).toBe(429);
    expect(eleventh.json().message).toBe('Too many codes sent to this email, try again later');
  });
});
