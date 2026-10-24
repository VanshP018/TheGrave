import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/lib/tokens.js';
import { attachRealtime } from '../src/realtime/index.js';
import { closeAll, resetState } from './helpers.js';

// The leaderboard can be limited to the viewer's school/college (decision.md D-079).
let app: FastifyInstance;
let rt: ReturnType<typeof attachRealtime>;

async function player(username: string, rating: number, institution: string | null) {
  return prisma.user.create({
    data: {
      username,
      email: `${username}@example.com`,
      passwordHash: 'x',
      rating,
      ratingDev: 60,
      ratedGames: 20,
      institution,
    },
  });
}
const as = (u: { id: string; username: string }) => ({
  authorization: `Bearer ${signAccessToken({ sub: u.id, username: u.username })}`,
});
const board = async (viewer: { id: string; username: string }, scope: string) =>
  (
    await app.inject({ method: 'GET', url: `/api/leaderboard?scope=${scope}`, headers: as(viewer) })
  ).json();

beforeAll(async () => {
  app = await buildApp();
  rt = attachRealtime(app);
  await app.ready();
  await resetState();
});
afterAll(() => closeAll(app));

describe('leaderboard scope', () => {
  it('ranks a school on its own, matching its name case-insensitively', async () => {
    const ana = await player('ana', 1900, 'IIT Delhi');
    await player('ben', 1800, 'iit delhi'); // same school, different spelling
    await player('cho', 1700, 'IIT Delhi');
    await player('dev', 1850, 'NIT Trichy'); // another school sits between them globally
    const solo = await player('eli', 1950, null); // no school
    const newbie = await prisma.user.create({
      data: {
        username: 'fay',
        email: 'fay@example.com',
        passwordHash: 'x',
        institution: 'IIT Delhi',
      },
    }); // same school but no rated games: not ranked
    await rt.leaderboard.rebuild();

    const global = await board(ana, 'global');
    expect(global).toMatchObject({ scope: 'global', institution: 'IIT Delhi', total: 5 });
    expect(global.entries[0].institution).toBeNull(); // eli

    const uni = await board(ana, 'university');
    expect(uni).toMatchObject({ scope: 'university', institution: 'IIT Delhi', total: 3 });
    expect(
      uni.entries.map((e: { username: string; rank: number }) => [e.username, e.rank]),
    ).toEqual([
      ['ana', 1],
      ['ben', 2],
      ['cho', 3],
    ]);
    // Within the school, ana is #1 even though eli outranks her globally.
    expect(uni.me).toEqual({ rank: 1, rating: 1900 });
    expect(global.me.rank).toBe(2);

    // Pagination follows the filtered list.
    const page = (
      await app.inject({
        method: 'GET',
        url: '/api/leaderboard?scope=university&offset=1&limit=1',
        headers: as(ana),
      })
    ).json();
    expect(page.entries.map((e: { username: string }) => e.username)).toEqual(['ben']);

    // Someone from a school with no rated players, and someone with no school at all, get an empty board.
    expect(await board(solo, 'university')).toMatchObject({
      institution: null,
      total: 0,
      entries: [],
      me: null,
    });
    expect(await board(newbie, 'university')).toMatchObject({
      institution: 'IIT Delhi',
      total: 3,
      me: null,
    });
    expect(
      (await app.inject({ method: 'GET', url: '/api/leaderboard?scope=nope', headers: as(ana) }))
        .statusCode,
    ).toBe(400);
  });
});
