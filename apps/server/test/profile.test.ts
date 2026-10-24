import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { attachRealtime } from '../src/realtime/index.js';
import { closeAll, registerUser, resetState } from './helpers.js';

// Profiles: bio, social links and an uploaded avatar (decision.md D-071).
let app: FastifyInstance;
let alice: { authorization: string };

// A real 1x1 PNG.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

beforeAll(async () => {
  // Profiles are served next to the leaderboard, which needs the realtime layer.
  app = await buildApp();
  attachRealtime(app);
  await app.ready();
  await resetState();
  alice = await registerUser(app, 'alice');
});
afterAll(() => closeAll(app));

const patch = (payload: object) =>
  app.inject({ method: 'PATCH', url: '/api/me/profile', headers: alice, payload });
const profile = async () =>
  (await app.inject({ method: 'GET', url: '/api/users/alice', headers: alice })).json();

describe('profile', () => {
  it('shows the institution given at registration', async () => {
    expect((await profile()).institution).toBe('Test University');
  });

  it('saves a bio and validated social links; empty strings clear', async () => {
    expect((await patch({ bio: 'x'.repeat(281) })).statusCode).toBe(400);
    for (const links of [
      { github: 'https://evil.example/alice' }, // wrong host
      { x: 'http://x.com/alice' }, // not https
      { website: 'javascript:alert(1)' },
    ])
      expect((await patch({ links })).statusCode, JSON.stringify(links)).toBe(400);

    expect(
      (
        await patch({
          bio: '  Breaks things for a living.  ',
          links: { github: 'https://github.com/alice', website: 'https://alice.dev' },
        })
      ).statusCode,
    ).toBe(200);
    expect(await profile()).toMatchObject({
      bio: 'Breaks things for a living.',
      links: { github: 'https://github.com/alice', website: 'https://alice.dev' },
      avatarUrl: null,
      peakRating: 1500,
    });
    await patch({ links: { website: '', x: 'https://x.com/alice' } });
    expect((await profile()).links).toEqual({
      github: 'https://github.com/alice',
      x: 'https://x.com/alice',
    });
  });

  it('uploads an avatar, serves it publicly with safe headers, and removes it', async () => {
    // An SVG (or anything else) wearing an image/png label is refused by its bytes.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>',
    ).toString('base64');
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/me/avatar',
      headers: alice,
      payload: { image: `data:image/png;base64,${svg}` },
    });
    expect(bad.statusCode).toBe(400);

    const up = await app.inject({
      method: 'PUT',
      url: '/api/me/avatar',
      headers: alice,
      payload: { image: `data:image/png;base64,${PNG}` },
    });
    expect(up.statusCode).toBe(200);
    const { avatarUrl } = up.json();
    expect(avatarUrl).toMatch(/^\/api\/users\/alice\/avatar\?v=\d+$/);
    expect((await profile()).avatarUrl).toBe(avatarUrl);
    expect(
      (await app.inject({ method: 'GET', url: '/api/me', headers: alice })).json().avatarUrl,
    ).toBe(avatarUrl);

    const img = await app.inject({ method: 'GET', url: avatarUrl }); // no auth needed
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(img.rawPayload.equals(Buffer.from(PNG, 'base64'))).toBe(true);

    expect(
      (await app.inject({ method: 'DELETE', url: '/api/me/avatar', headers: alice })).statusCode,
    ).toBe(200);
    expect((await profile()).avatarUrl).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/users/alice/avatar' })).statusCode).toBe(
      404,
    );
  });

  it('searches users by username prefix, case-insensitively', async () => {
    await registerUser(app, 'alina');
    await registerUser(app, 'bob');
    const search = async (q: string) =>
      (await app.inject({ method: 'GET', url: `/api/search/users?q=${q}`, headers: alice })).json();
    expect((await search('ALI')).map((u: { username: string }) => u.username).sort()).toEqual([
      'alice',
      'alina',
    ]);
    expect(await search('bo')).toEqual([{ username: 'bob', rating: 1500, avatarUrl: null }]);
    expect(await search('')).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/search/users?q=a' })).statusCode).toBe(
      401,
    );
  });
});
