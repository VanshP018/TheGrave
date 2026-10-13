import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { redis } from '../src/lib/redis.js';
import {
  Matchmaker,
  type ConfirmedMatch,
  type MatchmakerOptions,
  type Notifier,
} from '../src/matchmaking/matchmaker.js';
import { resetState } from './helpers.js';

type Event = { userId: string; event: string; payload: Record<string, unknown> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function createUsers(ratings: number[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, rating] of ratings.entries()) {
    const u = await prisma.user.create({
      data: {
        username: `p${i}_${rating}`,
        email: `p${i}_${rating}@x.io`,
        passwordHash: 'x',
        rating,
      },
    });
    ids.push(u.id);
  }
  return ids;
}

function setup(opts: Partial<MatchmakerOptions> = {}, local: string[] = []) {
  const events: Event[] = [];
  const confirmed: ConfirmedMatch[] = [];
  const notifier: Notifier = {
    toUser: (userId, event, ...args) =>
      events.push({ userId, event, payload: args[0] as Record<string, unknown> }),
    broadcast: () => {},
  };
  const mm = new Matchmaker(
    redis,
    notifier,
    { localUserIds: () => local, onConfirmed: (m) => void confirmed.push(m) },
    { windowStepMs: 60_000, ...opts },
  );
  const of = (userId: string, event: string) =>
    events.filter((e) => e.userId === userId && e.event === event);
  return { mm, events, confirmed, of };
}

beforeEach(resetState);
afterAll(async () => {
  await Promise.all([prisma.$disconnect(), redis.quit()]);
});

describe('queue', () => {
  it('joins once, reports duplicates as already-queued, and leaves', async () => {
    const [a] = await createUsers([1500]);
    const { mm } = setup();
    const first = await mm.join(a!);
    expect(first).toMatchObject({ ok: true, already: false });
    expect(await mm.join(a!)).toMatchObject({
      ok: true,
      already: true,
      joinedAt: first.ok && first.joinedAt,
    });
    expect(await redis.zscore('mm:queue', a!)).toBe('1500');
    expect(await mm.describe(a!)).toMatchObject({ state: 'queued' });
    expect(await mm.leave(a!)).toBe(true);
    expect(await mm.leave(a!)).toBe(false);
    expect(await mm.describe(a!)).toEqual({ state: 'idle' });
  });

  it('50 concurrent joins of one user produce exactly one entry', async () => {
    const [a] = await createUsers([1500]);
    const { mm } = setup();
    const results = await Promise.all(Array.from({ length: 50 }, () => mm.join(a!)));
    expect(results.filter((r) => r.ok && !r.already)).toHaveLength(1);
    expect(await redis.zcard('mm:queue')).toBe(1);
  });
});

describe('pairing', () => {
  it('pairs the longest-waiting player with the closest rating', async () => {
    const [a, b, c] = await createUsers([1500, 1540, 1510]);
    const { mm, of } = setup();
    for (const u of [a!, b!, c!]) await mm.join(u);
    expect((await mm.tick()).paired).toBe(1);
    expect(of(a!, 'match:found')[0]!.payload.opponent).toMatchObject({ id: c, rating: 1510 });
    expect(of(c!, 'match:found')[0]!.payload.opponent).toMatchObject({ id: a, rating: 1500 });
    expect(await mm.describe(b!)).toMatchObject({ state: 'queued' });
  });

  it('starts at ±50 and widens by 25 per step', async () => {
    const [a, b] = await createUsers([1500, 1600]);
    const { mm } = setup({ windowStepMs: 300 });
    await mm.join(a!);
    await mm.join(b!);
    expect((await mm.tick()).paired).toBe(0); // 100 apart, window 50
    await sleep(350);
    expect((await mm.tick()).paired).toBe(0); // window 75
    await sleep(300);
    expect((await mm.tick()).paired).toBe(1); // window 100
  });

  it('never pairs beyond the ±400 cap', async () => {
    const [a, b] = await createUsers([1000, 1500]);
    const { mm } = setup({ windowStepMs: 20 });
    await mm.join(a!);
    await mm.join(b!);
    await sleep(800); // uncapped window would be 50 + 25·40 = 1050
    expect((await mm.tick()).paired).toBe(0);
  });

  it('concurrent ticks never put a player in two matches', async () => {
    const ids = await createUsers(Array.from({ length: 100 }, (_, i) => 1000 + i * 7));
    const { mm, events } = setup({ windowBase: 400 });
    await Promise.all(ids.map((id) => mm.join(id)));
    const results = await Promise.all(Array.from({ length: 10 }, () => mm.tick()));
    expect(results.reduce((n, r) => n + r.paired, 0)).toBe(50);
    const found = events.filter((e) => e.event === 'match:found');
    expect(new Set(found.map((e) => e.userId)).size).toBe(100);
    expect(found).toHaveLength(100);
  });
});

describe('ready check', () => {
  async function pairedPair(opts: Partial<MatchmakerOptions> = {}) {
    const [a, b] = await createUsers([1500, 1510]);
    const ctx = setup(opts);
    await ctx.mm.join(a!);
    await ctx.mm.join(b!);
    const joinedA = Number(await redis.zscore('mm:joined', a!));
    await ctx.mm.tick();
    const matchId = ctx.of(a!, 'match:found')[0]!.payload.matchId as string;
    return { ...ctx, a: a!, b: b!, matchId, joinedA };
  }

  it('confirms when both accept and guards against queueing while in a match', async () => {
    const { mm, a, b, matchId, confirmed, of } = await pairedPair();
    expect(await mm.join(a)).toEqual({ ok: false, code: 'ALREADY_IN_MATCH' }); // during ready check
    expect(await mm.accept(matchId, a)).toBe(true);
    expect(confirmed).toHaveLength(0);
    expect(await mm.accept(matchId, b)).toBe(true);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.players.map((p) => p.id).sort()).toEqual([a, b].sort());
    expect(of(a, 'match:confirmed')[0]!.payload.opponent).toMatchObject({ id: b });

    expect(await mm.describe(a)).toEqual({ state: 'match', matchId });
    expect(await mm.join(b)).toEqual({ ok: false, code: 'ALREADY_IN_MATCH' }); // during match
    expect(await mm.release(matchId, [a, b])).toBe(2);
    expect(await mm.join(b)).toMatchObject({ ok: true });
  });

  it('rejects accepts from outsiders and for unknown matches', async () => {
    const [outsider] = await createUsers([1200]);
    const { mm, matchId } = await pairedPair();
    expect(await mm.accept(matchId, outsider!)).toBe(false);
    expect(await mm.accept('nope', outsider!)).toBe(false);
  });

  it('decline returns the other player to the queue with their original joinedAt', async () => {
    const { mm, a, b, matchId, joinedA, of } = await pairedPair();
    expect(await mm.decline(matchId, b)).toBe(true);
    expect(await mm.describe(a)).toEqual({ state: 'queued', joinedAt: joinedA });
    expect(await mm.describe(b)).toEqual({ state: 'idle' });
    expect(of(a, 'match:cancelled')[0]!.payload).toMatchObject({
      reason: 'declined',
      requeued: true,
    });
    expect(of(b, 'match:cancelled')[0]!.payload).toMatchObject({
      reason: 'declined',
      requeued: false,
    });
    expect(await mm.accept(matchId, a)).toBe(false);
  });

  it('timeout requeues players who accepted and drops those who did not', async () => {
    const { mm, a, b, matchId, joinedA, of } = await pairedPair({ readyTimeoutMs: 300 });
    await mm.accept(matchId, a);
    await sleep(350);
    expect(await mm.accept(matchId, b)).toBe(false); // too late, even before the tick runs
    const res = await mm.tick();
    expect(res.expired).toBe(1);
    expect(await mm.describe(a)).toEqual({ state: 'queued', joinedAt: joinedA });
    expect(await mm.describe(b)).toEqual({ state: 'idle' });
    expect(of(a, 'match:cancelled')[0]!.payload).toMatchObject({
      reason: 'timeout',
      requeued: true,
    });
    expect(of(b, 'match:cancelled')[0]!.payload).toMatchObject({
      reason: 'timeout',
      requeued: false,
    });
  });

  it('describe() lets a reconnecting client resume its ready check', async () => {
    const { mm, a, b, matchId } = await pairedPair();
    expect(await mm.describe(a)).toMatchObject({ state: 'ready', matchId, opponent: { id: b } });
  });
});

describe('leases (orphan protection)', () => {
  it('purges queue entries nobody renews, e.g. after a node crash', async () => {
    const [a] = await createUsers([1500]);
    const { mm, of } = setup({ leaseMs: 300 });
    await mm.join(a!);
    await sleep(350);
    expect((await mm.tick()).purged).toEqual([a]);
    expect(await mm.describe(a!)).toEqual({ state: 'idle' });
    expect(await redis.exists('mm:queue', 'mm:joined', 'mm:lease', `user:${a}:state`)).toBe(0);
    expect(of(a!, 'queue:left')[0]!.payload).toEqual({ reason: 'expired' });
  });

  it('keeps entries whose lease a node keeps renewing', async () => {
    const [a] = await createUsers([1500]);
    const { mm } = setup({ leaseMs: 300 }, [a!]);
    await mm.join(a!);
    for (let i = 0; i < 4; i++) {
      await sleep(120);
      await mm.renewLeases();
    }
    expect((await mm.tick()).purged).toEqual([]);
    expect(await mm.describe(a!)).toMatchObject({ state: 'queued' });
  });

  it('renewing does not enqueue users who are not queued', async () => {
    const [a] = await createUsers([1500]);
    const { mm } = setup({}, [a!]);
    await mm.renewLeases();
    expect(await redis.zcard('mm:lease')).toBe(0);
  });
});
