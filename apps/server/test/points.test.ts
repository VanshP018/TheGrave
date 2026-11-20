import type { Difficulty } from '@thegrave/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { signAccessToken } from '../src/lib/tokens.js';
import { userActivity } from '../src/modules/activity/points.js';
import { attachRealtime } from '../src/realtime/index.js';
import { closeAll, resetState } from './helpers.js';

// Points for solving: 1 per easy, 3 per medium, 5 per hard, DSA and programming together; ranked globally
// and per school/college. A problem counts once, at the time of its first full pass.
let app: FastifyInstance;

const user = (username: string, institution: string | null) =>
  prisma.user.create({
    data: { username, email: `${username}@example.com`, passwordHash: 'x', institution },
  });
const as = (u: { id: string; username: string }) => ({
  authorization: `Bearer ${signAccessToken({ sub: u.id, username: u.username })}`,
});
const problem = (slug: string, difficulty: Difficulty) =>
  prisma.problem.create({
    data: { slug, title: slug, difficulty, statement: 'x', starterCode: {} },
  });

type Who = { id: string };
type Prob = { id: string };
const solve = (
  who: Who,
  p: Prob,
  day: string,
  extra: { verdict?: 'ACCEPTED' | 'WRONG_ANSWER'; kind?: 'RUN' | 'SUBMIT' } = {},
) =>
  prisma.submission.create({
    data: {
      userId: who.id,
      problemId: p.id,
      kind: extra.kind ?? 'SUBMIT',
      language: 'python',
      code: 'x',
      status: 'DONE',
      verdict: extra.verdict ?? 'ACCEPTED',
      finishedAt: new Date(`${day}T12:00:00Z`),
    },
  });
const run = (who: Who, project: Prob, passed: number, total: number, day: string) =>
  prisma.projectRun.create({
    data: {
      userId: who.id,
      projectId: project.id,
      kind: 'SUBMIT',
      files: {},
      status: 'DONE',
      passed,
      total,
      finishedAt: new Date(`${day}T12:00:00Z`),
    },
  });

beforeAll(async () => {
  app = await buildApp();
  attachRealtime(app); // registers the user and leaderboard routes
  await app.ready();
  await resetState();
});
afterAll(() => closeAll(app));

describe('points and the problems leaderboard', () => {
  it('scores first solves only, ranks with ties, and limits a board to one school', async () => {
    const easy = await problem('e1', 'EASY');
    const medium = await problem('m1', 'MEDIUM');
    const hard = await problem('h1', 'HARD');
    const project = await prisma.project.create({
      data: {
        slug: 'p1',
        title: 'p1',
        difficulty: 'HARD',
        language: 'python',
        summary: 's',
        statement: 'x',
        files: {},
        hiddenTests: {},
        hiddenTestCount: 3,
      },
    });
    const ana = await user('ana', 'IIT Delhi');
    const ben = await user('ben', 'iit delhi'); // same school, different spelling
    const cho = await user('cho', 'NIT Trichy');
    const eli = await user('eli', null);
    const dev = await user('dev', 'IIT Delhi'); // never solves anything

    // ana: easy (solved twice, counts once) + medium + hard + the hard programming challenge = 1+3+5+5
    await solve(ana, easy, '2026-11-01');
    await solve(ana, easy, '2026-11-05');
    await solve(ana, medium, '2026-11-02');
    await solve(ana, hard, '2026-11-03');
    await run(ana, project, 2, 3, '2026-11-04'); // partial pass: earns nothing
    await run(ana, project, 3, 3, '2026-11-06');
    // ben: easy + medium; his other attempts do not count
    await solve(ben, easy, '2026-11-02');
    await solve(ben, medium, '2026-11-03');
    await solve(ben, hard, '2026-11-04', { verdict: 'WRONG_ANSWER' });
    await solve(ben, hard, '2026-11-04', { kind: 'RUN' }); // sample run, never counts
    await run(ben, project, 2, 2, '2026-11-05'); // the suite has 3 tests: a "full" pass of 2 is not one
    // cho and eli tie on 9 points
    for (const who of [cho, eli]) {
      await solve(who, easy, '2026-11-02');
      await solve(who, medium, '2026-11-02');
      await solve(who, hard, '2026-11-02');
    }

    const get = async (viewer: Who & { username: string }, query = '') =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/leaderboard/problems${query}`,
          headers: as(viewer),
        })
      ).json();

    const global = await get(ana);
    expect(global).toMatchObject({ scope: 'global', institution: 'IIT Delhi', total: 4 });
    expect(
      global.entries.map((e: { username: string; rank: number; points: number }) => [
        e.username,
        e.rank,
        e.points,
      ]),
    ).toEqual([
      ['ana', 1, 14],
      ['cho', 2, 9],
      ['eli', 2, 9],
      ['ben', 4, 4],
    ]);
    expect(global.entries[0]).toMatchObject({ solved: 4, dsa: 3, programming: 1 });
    expect(global.me).toEqual({ rank: 1, points: 14 });
    expect((await get(dev)).me).toBeNull(); // no solves, not ranked

    const campus = await get(ben, '?scope=university');
    expect(campus).toMatchObject({ scope: 'university', institution: 'iit delhi', total: 2 });
    expect(
      campus.entries.map((e: { username: string; rank: number }) => [e.username, e.rank]),
    ).toEqual([
      ['ana', 1],
      ['ben', 2],
    ]);
    expect(campus.me).toEqual({ rank: 2, points: 4 });

    // someone with no school has an empty campus board
    expect(await get(eli, '?scope=university')).toMatchObject({ total: 0, entries: [], me: null });

    // pagination follows the ranking
    const page = await get(ana, '?offset=1&limit=2');
    expect(page.entries.map((e: { username: string }) => e.username)).toEqual(['cho', 'eli']);
    expect(page.total).toBe(4);
  });

  it('builds the heat map days, totals, streaks and standing for one player', async () => {
    const ana = await prisma.user.findUniqueOrThrow({ where: { username: 'ana' } });
    const view = await userActivity(ana.id, ana.institution, new Date('2026-11-07T08:00:00Z'));
    expect(view).toMatchObject({
      points: 14,
      solved: 4,
      dsa: { easy: 1, medium: 1, hard: 1 },
      programming: { easy: 0, medium: 0, hard: 1 },
      activeDays: 4,
      to: '2026-11-07',
      rank: { global: 1, university: 1 },
    });
    // easy 11-01 (its repeat on 11-05 is ignored), medium 11-02, hard 11-03, project 11-06
    expect(view.days.map((d) => d.date)).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-06',
    ]);
    expect(view.days[3]).toMatchObject({
      programmingSolved: 1,
      programmingPoints: 5,
      dsaSolved: 0,
    });
    expect(view.longestStreak).toBe(3);
    // last solve was 11-06 and it is 11-07: the streak of 1 is still alive; two days later it is gone
    expect(view.currentStreak).toBe(1);
    const later = await userActivity(ana.id, ana.institution, new Date('2026-11-09T08:00:00Z'));
    expect(later.currentStreak).toBe(0);
    expect(later.longestStreak).toBe(3);

    const dev = await prisma.user.findUniqueOrThrow({ where: { username: 'dev' } });
    expect(await userActivity(dev.id, dev.institution)).toMatchObject({
      points: 0,
      solved: 0,
      days: [],
      rank: { global: null, university: null },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/users/ana/activity',
      headers: as(ana),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().points).toBe(14);
    expect(
      (await app.inject({ method: 'GET', url: '/api/users/nobody/activity', headers: as(ana) }))
        .statusCode,
    ).toBe(404);
  });
});
