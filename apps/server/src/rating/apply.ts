import type { RatingChange } from '@thegrave/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { rate, type Rating } from './glicko2.js';
import { effectiveRd } from './policy.js';

interface LockedUser {
  id: string;
  rating: number;
  ratingDev: number;
  volatility: number;
  rdUpdatedAt: Date;
}

/** Internal: also carries the exact values the leaderboard needs. Clients get `toRatingChange()`. */
export interface AppliedChange extends RatingChange {
  ratingExact: number;
  rdAfter: number;
}

export const toRatingChange = ({ userId, before, after, delta }: AppliedChange): RatingChange => ({
  userId,
  before,
  after,
  delta,
});

/**
 * Applies Glicko-2 for one finished match, inside the caller's transaction (decision.md D-048).
 * Idempotent per match: `ratedAt` is a compare-and-set gate, and RatingHistory has @@unique(matchId, userId)
 * as a backstop. Returns [] if the match was already rated (or is not FINISHED).
 */
export async function applyMatchRating(
  tx: Prisma.TransactionClient,
  matchId: string,
  players: [string, string],
  winnerId: string | null,
  now = new Date(),
): Promise<AppliedChange[]> {
  const gate = await tx.match.updateMany({
    where: { id: matchId, status: 'FINISHED', ratedAt: null },
    data: { ratedAt: now },
  });
  if (gate.count === 0) return [];

  // Row locks in id order: two transactions touching the same users can never deadlock.
  const rows = await tx.$queryRaw<LockedUser[]>`
    SELECT id, rating, "ratingDev", volatility, "rdUpdatedAt" FROM "User"
    WHERE id = ANY(${players}::uuid[]) ORDER BY id FOR UPDATE`;
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Both updates use the *pre-match* values of both players (simultaneous update).
  const pre = new Map<string, Rating>(
    players.map((id) => {
      const u = byId.get(id)!;
      return [
        id,
        { rating: u.rating, rd: effectiveRd(u, now.getTime()), volatility: u.volatility },
      ];
    }),
  );

  const changes: AppliedChange[] = [];
  for (const [me, them] of [players, [players[1], players[0]]] as const) {
    const before = pre.get(me)!;
    const opponent = pre.get(them)!;
    const score = winnerId === null ? 0.5 : winnerId === me ? 1 : 0;
    // periodFraction 0: idle time is already in `before.rd` via effectiveRd (D-047).
    const after = rate(before, [{ opponent, score }], { periodFraction: 0 });

    await tx.user.update({
      where: { id: me },
      data: {
        rating: after.rating,
        ratingDev: after.rd,
        volatility: after.volatility,
        rdUpdatedAt: now,
        ratedGames: { increment: 1 },
      },
    });
    await tx.ratingHistory.create({
      data: {
        userId: me,
        matchId,
        opponentId: them,
        outcome: score === 1 ? 'WIN' : score === 0 ? 'LOSS' : 'DRAW',
        ratingBefore: before.rating,
        ratingAfter: after.rating,
        delta: after.rating - before.rating,
        rdBefore: before.rd,
        rdAfter: after.rd,
        volatilityBefore: before.volatility,
        volatilityAfter: after.volatility,
        opponentRating: opponent.rating,
        createdAt: now,
      },
    });
    changes.push({
      userId: me,
      before: Math.round(before.rating),
      after: Math.round(after.rating),
      delta: Math.round(after.rating) - Math.round(before.rating),
      ratingExact: after.rating,
      rdAfter: after.rd,
    });
  }
  return changes;
}
