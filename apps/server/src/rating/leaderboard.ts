import { randomUUID } from 'node:crypto';
import type { LeaderboardEntry, LeaderboardPage } from '@thegrave/shared';
import type { Redis } from 'ioredis';
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../lib/prisma.js';
import type { AppliedChange } from './apply.js';
import { SCALE } from './glicko2.js';
import { effectiveRd, LEADERBOARD_MAX_RD, PROVISIONAL_RD, RATING_PERIOD_MS } from './policy.js';

export const LB_KEY = 'lb:rating';
const VERSION_KEY = 'lb:version';

/**
 * Swap a freshly built leaderboard in, but only if no incremental update happened while it was being
 * built; otherwise the rebuild (a slightly older snapshot) would overwrite a newer rating.
 * KEYS: tmp, live, version. ARGV: expected version. Returns 1 if swapped.
 */
const SWAP = `
if (redis.call('GET', KEYS[3]) or '0') ~= ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 0
end
if redis.call('EXISTS', KEYS[1]) == 1 then
  redis.call('RENAME', KEYS[1], KEYS[2])
else
  redis.call('DEL', KEYS[2])
end
return 1
`;

/** SQL twin of `effectiveRd`, so eligibility is decided in the database for a rebuild. */
const effectiveRdSql = Prisma.sql`LEAST(350, ${SCALE} * sqrt(power("ratingDev" / ${SCALE}, 2)
  + power(volatility, 2) * (EXTRACT(EPOCH FROM (now() - "rdUpdatedAt")) * 1000 / ${RATING_PERIOD_MS})))`;

export class Leaderboard {
  constructor(private readonly redis: Redis) {}

  /** Incremental update after a rated match. A fresh rating's RD is exact, so eligibility is known. */
  async applyChanges(changes: AppliedChange[]) {
    if (!changes.length) return;
    const tx = this.redis.multi();
    for (const c of changes) {
      // Score is the unrounded rating, so Redis order matches Postgres order exactly.
      if (c.rdAfter <= LEADERBOARD_MAX_RD) tx.zadd(LB_KEY, c.ratingExact, c.userId);
      else tx.zrem(LB_KEY, c.userId);
    }
    tx.incr(VERSION_KEY);
    await tx.exec();
  }

  /**
   * Rebuilds from Postgres (the source of truth) into a temp key, then swaps atomically: readers never
   * see a partial or empty board. Retries if a rating change raced the rebuild.
   */
  async rebuild(
    opts: { beforeSwap?: (attempt: number) => Promise<void> } = {},
  ): Promise<{ members: number; attempts: number }> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const version = (await this.redis.get(VERSION_KEY)) ?? '0';
      const rows = await prisma.$queryRaw<{ id: string; rating: number }[]>`
        SELECT id, rating FROM "User"
        WHERE "ratedGames" > 0 AND ${effectiveRdSql} <= ${LEADERBOARD_MAX_RD}`;
      const tmp = `${LB_KEY}:build:${randomUUID()}`;
      for (let i = 0; i < rows.length; i += 1000) {
        await this.redis.zadd(tmp, ...rows.slice(i, i + 1000).flatMap((r) => [r.rating, r.id]));
      }
      await opts.beforeSwap?.(attempt); // test seam: lets a test race a rating change into this window
      if ((await this.redis.eval(SWAP, 3, tmp, LB_KEY, VERSION_KEY, version)) === 1) {
        return { members: rows.length, attempts: attempt + 1 };
      }
    }
    throw new Error('leaderboard rebuild kept racing with rating updates');
  }

  /** Competition rank: 1 + number of players with a strictly higher rating. */
  async rank(userId: string): Promise<{ rank: number; rating: number } | null> {
    const score = await this.redis.zscore(LB_KEY, userId);
    if (score === null) return null;
    const higher = await this.redis.zcount(LB_KEY, `(${score}`, '+inf');
    return { rank: higher + 1, rating: Math.round(Number(score)) };
  }

  async page(offset: number, limit: number, viewerId?: string): Promise<LeaderboardPage> {
    const [raw, total, me] = await Promise.all([
      this.redis.zrevrange(LB_KEY, offset, offset + limit - 1, 'WITHSCORES'),
      this.redis.zcard(LB_KEY),
      viewerId ? this.rank(viewerId) : Promise.resolve(null),
    ]);
    const members: { id: string; score: number }[] = [];
    for (let i = 0; i < raw.length; i += 2)
      members.push({ id: raw[i]!, score: Number(raw[i + 1]) });

    const users = await prisma.user.findMany({
      where: { id: { in: members.map((m) => m.id) } },
      select: {
        id: true,
        username: true,
        ratingDev: true,
        volatility: true,
        rdUpdatedAt: true,
        ratedGames: true,
      },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    // Only the first row needs a ZCOUNT; after that, rank changes exactly when the score does.
    const entries: LeaderboardEntry[] = [];
    let rank = members.length
      ? (await this.redis.zcount(LB_KEY, `(${members[0]!.score}`, '+inf')) + 1
      : 0;
    members.forEach((m, i) => {
      if (i > 0 && m.score !== members[i - 1]!.score) rank = offset + i + 1;
      const u = byId.get(m.id);
      if (!u) return; // deleted user; the next rebuild drops them
      entries.push({
        rank,
        userId: m.id,
        username: u.username,
        rating: Math.round(m.score),
        provisional: effectiveRd(u) > PROVISIONAL_RD,
        games: u.ratedGames,
      });
    });
    return { total, offset, entries, me };
  }
}

/**
 * Materialises inactivity RD inflation for everyone idle for over an hour, in one statement.
 * Because inflation is additive in time (see `inflateRd`), running this at any cadence gives exactly
 * the RD the lazy `effectiveRd` would have computed (decision.md D-049).
 */
export async function materialiseRdDecay(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "User" SET "ratingDev" = ${effectiveRdSql}, "rdUpdatedAt" = now()
    WHERE "rdUpdatedAt" < now() - interval '1 hour' AND "ratingDev" < 350`;
}
