import type { LeaderboardPage, MatchHistoryPage, ProfileView } from '@thegrave/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { battleQueue } from '../src/battle/queue.js';
import { BattleService, type BattleNotifier } from '../src/battle/service.js';
import { submissionsQueue } from '../src/judge/queue.js';
import { prisma } from '../src/lib/prisma.js';
import { redis } from '../src/lib/redis.js';
import { signAccessToken } from '../src/lib/tokens.js';
import { Matchmaker } from '../src/matchmaking/matchmaker.js';
import { userRoutes } from '../src/modules/users/routes.js';
import { applyMatchRating, type AppliedChange } from '../src/rating/apply.js';
import { inflateRd } from '../src/rating/glicko2.js';
import { LB_KEY, Leaderboard, materialiseRdDecay } from '../src/rating/leaderboard.js';
import { startRatingMaintenance } from '../src/rating/maintenance.js';
import { effectiveRd, LEADERBOARD_MAX_RD, RATING_PERIOD_MS } from '../src/rating/policy.js';
import { STARTER_CODE } from '../src/seed/build.js';
import { resetState } from './helpers.js';

const DAY = RATING_PERIOD_MS;
const quiet: BattleNotifier = {
  toUser: () => {},
  toRoom: () => {},
  broadcast: () => {},
  joinRoom: () => {},
  isConnected: async () => true,
};
const leaderboard = new Leaderboard(redis);
const mm = new Matchmaker(redis, quiet, { localUserIds: () => [], onConfirmed: () => {} });
const battle = new BattleService(quiet, mm, leaderboard);

let app: FastifyInstance;
let problemId: string;
let seq = 0;

beforeAll(async () => {
  app = await buildApp();
  await app.register(userRoutes, { prefix: '/api', leaderboard });
  await app.ready();
});
beforeEach(async () => {
  await resetState();
  problemId = (
    await prisma.problem.create({
      data: {
        slug: 'p',
        title: 'Sum of Array',
        difficulty: 'EASY',
        statement: '',
        starterCode: STARTER_CODE,
      },
    })
  ).id;
});
afterAll(async () => {
  await app.close();
  await Promise.all([battleQueue.close(), submissionsQueue.close()]);
  await Promise.all([prisma.$disconnect(), redis.quit()]);
});

const user = (
  data: Partial<{ rating: number; ratingDev: number; rdUpdatedAt: Date; ratedGames: number }> = {},
) => {
  const username = `u${seq++}`;
  return prisma.user.create({
    data: { username, email: `${username}@x.io`, passwordHash: 'x', ...data },
  });
};
const auth = (u: { id: string; username: string }) => ({
  authorization: `Bearer ${signAccessToken({ sub: u.id, username: u.username })}`,
});
async function liveMatch(a: string, b: string) {
  return prisma.match.create({
    data: {
      problemId,
      status: 'ACTIVE',
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 60_000),
      players: {
        create: [
          { userId: a, ratingBefore: 1500 },
          { userId: b, ratingBefore: 1500 },
        ],
      },
    },
  });
}
const win = (matchId: string, winnerId: string) =>
  battle.finish(matchId, { status: 'FINISHED', winnerId, endReason: 'SOLVED' });

describe('rating on match finish', () => {
  it('applies Glicko-2 to both players in the finish transaction and records history', async () => {
    const [a, b] = [await user(), await user()];
    const m = await liveMatch(a.id, b.id);
    expect(await win(m.id, a.id)).toBe(true);

    const [ua, ub] = await Promise.all(
      [a, b].map((u) => prisma.user.findUniqueOrThrow({ where: { id: u.id } })),
    );
    expect(ua!.rating).toBeGreaterThan(1500);
    expect(ub!.rating).toBeLessThan(1500);
    expect(ua!.rating - 1500).toBeCloseTo(1500 - ub!.rating, 6); // equal players: symmetric
    expect(ua!.ratingDev).toBeLessThan(350);
    expect([ua!.ratedGames, ub!.ratedGames]).toEqual([1, 1]);

    const hist = await prisma.ratingHistory.findMany({ where: { matchId: m.id } });
    expect(hist.map((h) => h.outcome).sort()).toEqual(['LOSS', 'WIN']);
    const ha = hist.find((h) => h.userId === a.id)!;
    expect(ha).toMatchObject({
      opponentId: b.id,
      ratingBefore: 1500,
      ratingAfter: ua!.rating,
      rdBefore: 350,
    });
    expect(ha.delta).toBeCloseTo(ua!.rating - 1500, 9);
    expect((await prisma.match.findUniqueOrThrow({ where: { id: m.id } })).ratedAt).not.toBeNull();

    // The battle view carries the rounded deltas for the result screen.
    const view = await battle.view(m.id, a.id);
    expect(view.result?.ratingChanges?.find((c) => c.userId === a.id)).toEqual({
      userId: a.id,
      before: 1500,
      after: Math.round(ua!.rating),
      delta: Math.round(ua!.rating) - 1500,
    });
  });

  it('is idempotent per match: concurrent finishes and replays rate exactly once', async () => {
    const [a, b] = [await user(), await user()];
    const m = await liveMatch(a.id, b.id);
    const results = await Promise.all(Array.from({ length: 8 }, () => win(m.id, a.id)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });

    // Replaying the rating step directly (e.g. a retried job) is a no-op.
    const replay = await prisma.$transaction((tx) =>
      applyMatchRating(tx, m.id, [a.id, b.id], a.id),
    );
    expect(replay).toEqual([]);
    expect(await prisma.ratingHistory.count({ where: { matchId: m.id } })).toBe(2);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).rating).toBe(
      after.rating,
    );
  });

  it('a draw between equals keeps ratings and shrinks RD', async () => {
    const [a, b] = [await user(), await user()];
    const m = await liveMatch(a.id, b.id);
    await battle.finish(m.id, { status: 'FINISHED', winnerId: null, endReason: 'TIMEOUT' });
    const ua = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(ua.rating).toBeCloseTo(1500, 9);
    expect(ua.ratingDev).toBeLessThan(350);
    expect((await prisma.ratingHistory.findFirstOrThrow({ where: { userId: a.id } })).outcome).toBe(
      'DRAW',
    );
  });

  it('ABORTED matches are unrated', async () => {
    const [a, b] = [await user(), await user()];
    const m = await liveMatch(a.id, b.id);
    await battle.finish(m.id, { status: 'ABORTED', winnerId: null, endReason: 'ABANDONED' });
    expect(await prisma.ratingHistory.count()).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).ratedGames).toBe(0);
    expect((await prisma.match.findUniqueOrThrow({ where: { id: m.id } })).ratedAt).toBeNull();
  });

  it("uses the idle-inflated RD at rating time (a returning player's rating moves more)", async () => {
    const back = await user({
      ratingDev: 60,
      rdUpdatedAt: new Date(Date.now() - 100 * DAY),
      ratedGames: 50,
    });
    const opp = await user({ ratingDev: 60, ratedGames: 50 });
    const m = await liveMatch(back.id, opp.id);
    await win(m.id, back.id);
    const h = await prisma.ratingHistory.findFirstOrThrow({ where: { userId: back.id } });
    expect(h.rdBefore).toBeCloseTo(inflateRd(60, 0.06, 100), 1);
    const ho = await prisma.ratingHistory.findFirstOrThrow({ where: { userId: opp.id } });
    expect(Math.abs(h.delta)).toBeGreaterThan(Math.abs(ho.delta) * 2);
  });
});

describe('inactivity RD decay (periodic job)', () => {
  it('materialises exactly the RD the lazy formula predicts, and is idempotent', async () => {
    const u = await user({
      ratingDev: 60,
      rdUpdatedAt: new Date(Date.now() - 30 * DAY),
      ratedGames: 10,
    });
    const predicted = effectiveRd(u);
    expect(await materialiseRdDecay()).toBeGreaterThanOrEqual(1);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.ratingDev).toBeCloseTo(predicted, 3);
    expect(Date.now() - after.rdUpdatedAt.getTime()).toBeLessThan(5000);

    // Running again changes nothing (recently materialised), and the lazy view agrees with the stored one.
    await materialiseRdDecay();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).ratingDev).toBe(
      after.ratingDev,
    );
    expect(effectiveRd(after)).toBeCloseTo(after.ratingDev, 3);
  });

  it('splitting idle time across job runs gives the same RD as one run (additivity)', async () => {
    const once = await user({ ratingDev: 70, rdUpdatedAt: new Date(Date.now() - 40 * DAY) });
    const twice = await user({ ratingDev: 70, rdUpdatedAt: new Date(Date.now() - 40 * DAY) });
    // `twice`: decay the first 25 days, then the remaining 15.
    await prisma.user.update({
      where: { id: twice.id },
      data: { ratingDev: inflateRd(70, 0.06, 25), rdUpdatedAt: new Date(Date.now() - 15 * DAY) },
    });
    await materialiseRdDecay();
    const [a, b] = await Promise.all(
      [once, twice].map((u) => prisma.user.findUniqueOrThrow({ where: { id: u.id } })),
    );
    expect(b!.ratingDev).toBeCloseTo(a!.ratingDev, 3);
  });
});

describe('leaderboard', () => {
  /** What the leaderboard must contain, computed independently from the DB rows in TypeScript. */
  async function expectedBoard() {
    const users = await prisma.user.findMany();
    return users
      .filter((u) => u.ratedGames > 0 && effectiveRd(u) <= LEADERBOARD_MAX_RD)
      .sort((x, y) => y.rating - x.rating || (y.id > x.id ? 1 : -1));
  }

  async function randomPopulation(n: number) {
    let s = 7;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const ratings = [1500, 1650.5, 1800]; // some exact ties
    await prisma.user.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        username: `pop${i}`,
        email: `pop${i}@x.io`,
        passwordHash: 'x',
        rating: rand() < 0.15 ? ratings[i % 3]! : 900 + rand() * 1500,
        ratingDev: 40 + rand() * 310,
        rdUpdatedAt: new Date(Date.now() - rand() * 400 * DAY),
        ratedGames: rand() < 0.2 ? 0 : 1 + Math.floor(rand() * 40),
      })),
    });
  }

  it('is consistent with Postgres after a rebuild, even from a corrupted Redis', async () => {
    await randomPopulation(400);
    const stranger = await user({ ratedGames: 3, ratingDev: 80 });
    // Corrupt: phantom members, wrong scores, a stranger missing.
    await redis.zadd(LB_KEY, 9999, 'ghost', 1, (await prisma.user.findFirstOrThrow()).id);
    await redis.zrem(LB_KEY, stranger.id);

    await leaderboard.rebuild();
    const expected = await expectedBoard();
    const actual = await redis.zrevrange(LB_KEY, 0, -1, 'WITHSCORES');
    expect(expected.length).toBeGreaterThan(50);
    expect(actual.filter((_, i) => i % 2 === 0)).toEqual(expected.map((u) => u.id));
    expect(actual.filter((_, i) => i % 2 === 1).map(Number)).toEqual(expected.map((u) => u.rating));
  });

  it('pages concatenate to the full board with competition ranks (ties share a rank)', async () => {
    await randomPopulation(150);
    await leaderboard.rebuild();
    const expected = await expectedBoard();
    const ranks = expected.map((u) => 1 + expected.filter((o) => o.rating > u.rating).length);

    const all = [];
    for (let offset = 0; offset < expected.length; offset += 17) {
      const page = await leaderboard.page(offset, 17);
      expect(page.total).toBe(expected.length);
      all.push(...page.entries);
    }
    expect(all.map((e) => e.userId)).toEqual(expected.map((u) => u.id));
    expect(all.map((e) => e.rank)).toEqual(ranks);
    expect(new Set(ranks).size).toBeLessThan(ranks.length); // the population really has ties
    expect(expected.length).toBeGreaterThan(20);
    const mid = Math.floor(expected.length / 2);
    const someone = expected[mid]!;
    expect(await leaderboard.rank(someone.id)).toEqual({
      rank: ranks[mid],
      rating: Math.round(someone.rating),
    });
  });

  it('a rating change racing a rebuild is not lost (compare-and-swap on a version)', async () => {
    const a = await user({ rating: 1600, ratingDev: 80, ratedGames: 5 });
    await leaderboard.rebuild();
    const res = await leaderboard.rebuild({
      beforeSwap: async (attempt) => {
        if (attempt > 0) return;
        // Between the rebuild's DB read and its swap: a match commits and updates Redis incrementally.
        await prisma.user.update({ where: { id: a.id }, data: { rating: 1720 } });
        const change: AppliedChange = {
          userId: a.id,
          before: 1600,
          after: 1720,
          delta: 120,
          ratingExact: 1720,
          rdAfter: 80,
        };
        await leaderboard.applyChanges([change]);
      },
    });
    expect(res.attempts).toBe(2); // first swap refused, second built from fresh data
    expect(await redis.zscore(LB_KEY, a.id)).toBe('1720');
  });

  it('players enter after enough games and leave when idle RD passes the threshold', async () => {
    const [a, b] = [
      await user({ ratingDev: 150, ratedGames: 4 }),
      await user({ ratingDev: 150, ratedGames: 4 }),
    ];
    await win((await liveMatch(a.id, b.id)).id, a.id);
    expect(await leaderboard.rank(a.id)).not.toBeNull(); // incremental add on match finish

    await prisma.user.update({
      where: { id: a.id },
      data: { rdUpdatedAt: new Date(Date.now() - 2000 * DAY) },
    });
    await materialiseRdDecay();
    await leaderboard.rebuild();
    expect(await leaderboard.rank(a.id)).toBeNull();
    expect(await leaderboard.rank(b.id)).not.toBeNull();
  });

  it('is rebuilt from Postgres on boot and schedules the decay job once', async () => {
    const a = await user({ rating: 1700, ratingDev: 70, ratedGames: 9 });
    await redis.del(LB_KEY);
    const m1 = await startRatingMaintenance(leaderboard);
    const m2 = await startRatingMaintenance(leaderboard); // second API node
    expect(await redis.zscore(LB_KEY, a.id)).toBe('1700');
    const { Queue } = await import('bullmq');
    const q = new Queue('maintenance', { connection: redis });
    expect((await q.getJobSchedulers()).map((j) => j.key)).toEqual(['rd-decay']);
    await q.close();
    await m1.close();
    await m2.close();
  });
});

describe('profile & history API', () => {
  it('reports W/L/D, the rating graph and keyset-paginated match history', async () => {
    const [me, opp] = [await user(), await user()];
    const outcomes: (string | null)[] = [];
    for (let i = 0; i < 23; i++) {
      const m = await liveMatch(me.id, opp.id);
      const winner = i % 3 === 0 ? opp.id : i % 3 === 1 ? me.id : null;
      outcomes.push(winner);
      await battle.finish(m.id, {
        status: 'FINISHED',
        winnerId: winner,
        endReason: winner ? 'SOLVED' : 'TIMEOUT',
      });
    }
    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${me.username}`,
      headers: auth(me),
    });
    const p = res.json() as ProfileView;
    expect(p).toMatchObject({ games: 23, wins: 8, losses: 8, draws: 7 });
    expect(p.history).toHaveLength(24);
    expect(p.history[0]!.rating).toBe(1500);
    const dbRating = (await prisma.user.findUniqueOrThrow({ where: { id: me.id } })).rating;
    expect(p.history.at(-1)!.rating).toBe(Math.round(dbRating));

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/api/users/${me.username}/matches?limit=10${cursor ? `&cursor=${cursor}` : ''}`;
      const page = (
        await app.inject({ method: 'GET', url, headers: auth(me) })
      ).json() as MatchHistoryPage;
      seen.push(...page.items.map((i) => i.matchId));
      expect(page.items[0]?.problem.title).toBe('Sum of Array');
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(23);

    const bad = await app.inject({
      method: 'GET',
      url: `/api/users/${me.username}/matches?cursor=zzz`,
      headers: auth(me),
    });
    expect(bad.statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/api/users/nobody', headers: auth(me) })).statusCode,
    ).toBe(404);
  });

  it('GET /leaderboard includes the viewer’s own rank', async () => {
    const a = await user({ rating: 1800, ratingDev: 70, ratedGames: 9 });
    await user({ rating: 1900, ratingDev: 70, ratedGames: 9 });
    await leaderboard.rebuild();
    const page = (
      await app.inject({ method: 'GET', url: '/api/leaderboard?limit=1', headers: auth(a) })
    ).json() as LeaderboardPage;
    expect(page.entries).toHaveLength(1);
    expect(page.me).toEqual({ rank: 2, rating: 1800 });
  });
});
