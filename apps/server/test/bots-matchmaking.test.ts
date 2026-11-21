import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { redis } from '../src/lib/redis.js';
import {
  Matchmaker,
  type ConfirmedMatch,
  type MatchmakerOptions,
  type Notifier,
} from '../src/matchmaking/matchmaker.js';
import { seedBots } from '../src/seed/bots.js';
import { resetState } from './helpers.js';

// A player who waits with nobody to play is matched with a practice bot (the one closest in rating), through
// the same ready check as any match. Bots are never queued, and a human is always preferred.
type Event = { userId: string; event: string; payload: Record<string, unknown> };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function human(name: string, rating: number) {
  return prisma.user.create({
    data: { username: name, email: `${name}@x.io`, passwordHash: 'x', rating, ratedGames: 20 },
  });
}

function setup(opts: Partial<MatchmakerOptions> = {}) {
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
    { localUserIds: () => [], onConfirmed: (m) => void confirmed.push(m) },
    { windowStepMs: 60_000, botJitterMs: 0, ...opts },
  );
  const found = (userId: string) =>
    events.filter((e) => e.userId === userId && e.event === 'match:found').at(-1)?.payload as
      | {
          matchId: string;
          opponent: { id: string; username: string; rating: number; bot?: boolean };
          expiresAt: number;
        }
      | undefined;
  return { mm, events, confirmed, found };
}

beforeEach(async () => {
  await resetState();
  await seedBots();
});
afterAll(async () => {
  await Promise.all([prisma.$disconnect(), redis.quit()]);
});

describe('matching with a practice bot', () => {
  it('does nothing while bots are off', async () => {
    const a = await human('solo', 1500);
    const { mm, found } = setup(); // botAfterMs defaults to null
    await mm.join(a.id);
    await sleep(150);
    await mm.tick();
    expect(found(a.id)).toBeUndefined();
    expect(await mm.describe(a.id)).toMatchObject({ state: 'queued' });
  });

  it('waits for the delay, then offers the closest bot, already accepted', async () => {
    const a = await human('solo', 1530);
    const { mm, found } = setup({ botAfterMs: 300 });
    await mm.join(a.id);
    await mm.tick();
    expect(found(a.id)).toBeUndefined(); // not yet: a human might still turn up

    await sleep(350);
    await mm.tick();
    const f = found(a.id)!;
    expect(f.opponent.bot).toBe(true);
    // one of the few bots nearest 1530: never a distant one
    expect(Math.abs(f.opponent.rating - 1530)).toBeLessThanOrEqual(120);
    expect(await redis.zscore('mm:queue', a.id)).toBeNull(); // out of the queue, in a ready check
    expect(await mm.describe(a.id)).toMatchObject({
      state: 'ready',
      opponent: { bot: true, username: f.opponent.username },
    });
  });

  it('confirms as soon as the human accepts, and names the bot as the opponent', async () => {
    const a = await human('solo', 1530);
    const { mm, found, confirmed } = setup({ botAfterMs: 0 });
    await mm.join(a.id);
    await sleep(20);
    await mm.tick();
    const f = found(a.id)!;
    await mm.accept(f.matchId, a.id);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.mode).toBe('DSA');
    const opp = confirmed[0]!.players.find((p) => p.id !== a.id)!;
    expect(opp).toMatchObject({ id: f.opponent.id, bot: true });
  });

  it('prefers a human opponent over a bot', async () => {
    const a = await human('ann', 1500);
    const b = await human('bob', 1510);
    const { mm, found } = setup({ botAfterMs: 0 });
    await mm.join(a.id);
    await mm.join(b.id);
    await sleep(20);
    await mm.tick();
    expect(found(a.id)!.opponent.bot).toBeUndefined();
    expect(found(a.id)!.opponent.id).toBe(b.id);
    expect(found(b.id)!.opponent.id).toBe(a.id);
  });

  it('declining frees the bot without ever queueing it', async () => {
    const a = await human('solo', 1500);
    const { mm, found } = setup({ botAfterMs: 0 });
    await mm.join(a.id);
    await sleep(20);
    await mm.tick();
    const f = found(a.id)!;
    await mm.decline(f.matchId, a.id);
    expect(await redis.zscore('mm:queue', f.opponent.id)).toBeNull();
    expect(await mm.describe(f.opponent.id)).toEqual({ state: 'idle' });
    expect(await mm.describe(a.id)).toEqual({ state: 'idle' });
  });

  it('a ready check nobody accepts releases the bot and does not queue it', async () => {
    const a = await human('solo', 1500);
    const { mm, found } = setup({ botAfterMs: 0, readyTimeoutMs: 150 });
    await mm.join(a.id);
    await sleep(20);
    await mm.tick();
    const f = found(a.id)!;
    await sleep(200);
    await mm.tick(); // expires the ready check
    expect(await redis.zscore('mm:queue', f.opponent.id)).toBeNull();
    expect(await redis.zscore('mm:joined', f.opponent.id)).toBeNull();
    expect(await mm.describe(f.opponent.id)).toEqual({ state: 'idle' });
    expect(await mm.describe(a.id)).toEqual({ state: 'idle' }); // never accepted, so dropped from the queue
  });

  it('gives a second waiting player a different bot while the first is busy', async () => {
    const a = await human('first', 1500);
    const b = await human('second', 1500);
    const { mm, found } = setup({ botAfterMs: 0 });
    await mm.join(a.id);
    await sleep(20);
    await mm.tick();
    const first = found(a.id)!.opponent;

    await mm.join(b.id);
    await sleep(20);
    await mm.tick();
    const second = found(b.id)!.opponent;
    expect(second.bot).toBe(true);
    expect(second.id).not.toBe(first.id);
    expect(Math.abs(second.rating - 1500)).toBeLessThanOrEqual(250);
  });

  it('does not hand the same bot straight back after a decline', async () => {
    const a = await human('picky', 1500);
    const { mm, found } = setup({ botAfterMs: 0 });
    const seen: string[] = [];
    for (let round = 0; round < 3; round++) {
      await mm.join(a.id);
      await sleep(20);
      await mm.tick();
      const f = found(a.id)!;
      seen.push(f.opponent.id);
      await mm.decline(f.matchId, a.id);
    }
    // each of the last three bots differs from the one before it, and from the one before that
    expect(new Set(seen).size).toBe(3);
  });

  it('works for the programming queue as well', async () => {
    const a = await human('coder', 1100);
    const { mm, found } = setup({ mode: 'PROGRAMMING', botAfterMs: 0 });
    await mm.join(a.id);
    await sleep(20);
    await mm.tick();
    const { opponent } = found(a.id)!;
    expect(opponent.bot).toBe(true);
    expect(Math.abs(opponent.rating - 1100)).toBeLessThanOrEqual(150); // one of the nearest
  });
});
