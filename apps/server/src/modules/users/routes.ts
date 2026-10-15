import type {
  LeaderboardPage,
  MatchHistoryItem,
  MatchHistoryPage,
  ProfileView,
} from '@thegrave/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { DEFAULT_RATING } from '../../rating/glicko2.js';
import type { Leaderboard } from '../../rating/leaderboard.js';
import { effectiveRd, PROVISIONAL_RD } from '../../rating/policy.js';

const pageQuery = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const usernameParams = z.object({ username: z.string().min(1).max(20) });
const historyQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const MAX_GRAPH_POINTS = 500;

/** Opaque keyset cursor over (createdAt, id) DESC: stable under inserts, O(log n) per page. */
const encodeCursor = (at: Date, id: string) =>
  Buffer.from(`${at.getTime()}_${id}`).toString('base64url');
function decodeCursor(cursor: string): { at: Date; id: string } | null {
  const [ms, id] = Buffer.from(cursor, 'base64url').toString().split('_');
  return ms && id && /^\d+$/.test(ms) && z.uuid().safeParse(id).success
    ? { at: new Date(Number(ms)), id }
    : null;
}

const notFound = { error: 'Not Found', message: 'User not found' };

export async function userRoutes(
  app: FastifyInstance,
  { leaderboard }: { leaderboard: Leaderboard },
) {
  app.addHook('onRequest', app.authenticate);

  app.get('/leaderboard', async (req): Promise<LeaderboardPage> => {
    const { offset, limit } = pageQuery.parse(req.query);
    return leaderboard.page(offset, limit, req.auth!.userId);
  });

  app.get('/users/:username', async (req, reply) => {
    const { username } = usernameParams.parse(req.params);
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return reply.code(404).send(notFound);

    const [counts, points, rank] = await Promise.all([
      prisma.ratingHistory.groupBy({ by: ['outcome'], where: { userId: user.id }, _count: true }),
      prisma.ratingHistory.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: MAX_GRAPH_POINTS,
        select: { createdAt: true, ratingBefore: true, ratingAfter: true },
      }),
      leaderboard.rank(user.id),
    ]);
    const count = (o: 'WIN' | 'LOSS' | 'DRAW') => counts.find((c) => c.outcome === o)?._count ?? 0;
    const ordered = points.reverse();
    const rd = effectiveRd(user);
    const body: ProfileView = {
      userId: user.id,
      username: user.username,
      joinedAt: user.createdAt.getTime(),
      rating: Math.round(user.rating),
      rd: Math.round(rd),
      provisional: rd > PROVISIONAL_RD,
      rank: rank?.rank ?? null,
      games: user.ratedGames,
      wins: count('WIN'),
      losses: count('LOSS'),
      draws: count('DRAW'),
      history: [
        // Starting point: the rating before the oldest game shown (1500 when the full history fits).
        {
          at:
            user.ratedGames <= MAX_GRAPH_POINTS
              ? user.createdAt.getTime()
              : ordered[0]!.createdAt.getTime(),
          rating: Math.round(ordered[0]?.ratingBefore ?? DEFAULT_RATING),
        },
        ...ordered.map((p) => ({ at: p.createdAt.getTime(), rating: Math.round(p.ratingAfter) })),
      ],
    };
    return body;
  });

  app.get('/users/:username/matches', async (req, reply) => {
    const { username } = usernameParams.parse(req.params);
    const { cursor, limit } = historyQuery.parse(req.query);
    const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!user) return reply.code(404).send(notFound);
    const after = cursor ? decodeCursor(cursor) : null;
    if (cursor && !after)
      return reply.code(400).send({ error: 'Bad Request', message: 'Invalid cursor' });

    const rows = await prisma.ratingHistory.findMany({
      where: {
        userId: user.id,
        ...(after && {
          OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        match: {
          select: { endReason: true, problem: { select: { title: true, difficulty: true } } },
        },
      },
    });
    const page = rows.slice(0, limit);
    const opponents = await prisma.user.findMany({
      where: { id: { in: page.map((r) => r.opponentId) } },
      select: { id: true, username: true },
    });
    const names = new Map(opponents.map((o) => [o.id, o.username]));
    const items: MatchHistoryItem[] = page.map((r) => ({
      matchId: r.matchId,
      at: r.createdAt.getTime(),
      outcome: r.outcome,
      delta: Math.round(r.ratingAfter) - Math.round(r.ratingBefore),
      ratingAfter: Math.round(r.ratingAfter),
      opponent: {
        username: names.get(r.opponentId) ?? 'deleted',
        rating: Math.round(r.opponentRating),
      },
      endReason: r.match.endReason!,
      problem: r.match.problem,
    }));
    const last = page.at(-1);
    const body: MatchHistoryPage = {
      items,
      nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
    return body;
  });
}
