import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { BOTS } from '../src/bots/roster.js';
import { prisma } from '../src/lib/prisma.js';
import { redis } from '../src/lib/redis.js';
import { seedBots } from '../src/seed/bots.js';
import { resetState } from './helpers.js';

// The seed creates the roster, renames accounts from the first roster in place (their match history stays
// attached), and never takes a name a person already has.
beforeEach(resetState);
afterAll(async () => {
  await Promise.all([prisma.$disconnect(), redis.quit()]);
});

describe('seeding the practice bots', () => {
  it('creates the whole roster, ready to play, and is safe to run again', async () => {
    const first = await seedBots();
    expect(first).toHaveLength(BOTS.length);
    expect(first.every((b) => b.created)).toBe(true);
    const again = await seedBots();
    expect(again.every((b) => !b.created && !b.renamed)).toBe(true);

    const rows = await prisma.user.findMany({ where: { isBot: true }, orderBy: { rating: 'asc' } });
    expect(rows).toHaveLength(BOTS.length);
    for (const [i, r] of rows.entries()) {
      expect(r).toMatchObject({
        username: BOTS[i]!.username,
        rating: BOTS[i]!.rating,
        ratingDev: 40,
        ratedGames: 0,
      });
      expect(r.emailVerifiedAt).not.toBeNull();
      expect(r.passwordHash).toMatch(/^\$argon2id\$/); // a real hash of a secret nobody has
    }
  });

  it('renames an account from the first roster in place, keeping its id and match history', async () => {
    const old = await prisma.user.create({
      data: {
        username: 'ArrayAnt',
        email: 'arrayant@bots.grave.invalid',
        passwordHash: 'x',
        isBot: true,
        rating: 800,
      },
    });
    const human = await prisma.user.create({
      data: { username: 'alice', email: 'alice@x.io', passwordHash: 'x' },
    });
    const match = await prisma.match.create({
      data: {
        startsAt: new Date(),
        endsAt: new Date(),
        status: 'FINISHED',
        players: {
          create: [
            { userId: human.id, ratingBefore: 1500 },
            { userId: old.id, ratingBefore: 800 },
          ],
        },
      },
    });

    const out = await seedBots();
    const renamed = out.find((b) => b.renamed)!;
    expect(renamed.username).toBe('megha_codes');
    expect(out.filter((b) => b.renamed)).toHaveLength(1); // only the one that existed

    const after = await prisma.user.findUniqueOrThrow({ where: { id: old.id } });
    expect(after).toMatchObject({ username: 'megha_codes', isBot: true, rating: 800 });
    expect(await prisma.matchPlayer.count({ where: { matchId: match.id } })).toBe(2);
    expect(await prisma.user.count({ where: { isBot: true } })).toBe(BOTS.length); // no duplicate
  });

  it('never takes a name a person already has', async () => {
    const taken = await prisma.user.create({
      data: { username: 'anya_r', email: 'anya@x.io', passwordHash: 'x', rating: 1234 },
    });
    await seedBots();
    expect(await prisma.user.findUniqueOrThrow({ where: { id: taken.id } })).toMatchObject({
      username: 'anya_r',
      isBot: false,
      rating: 1234,
    });
    const bot = await prisma.user.findFirstOrThrow({ where: { isBot: true, username: 'anya_r2' } });
    expect(bot.rating).toBe(1500);
    // and it stays that bot on the next run rather than being created again
    await seedBots();
    expect(await prisma.user.count({ where: { isBot: true } })).toBe(BOTS.length);
  });
});
