import {
  avatarUploadSchema,
  AVATAR_MAX_BYTES,
  profileUpdateSchema,
  type LeaderboardPage,
  type MatchHistoryItem,
  type MatchHistoryPage,
  type ProfileView,
  type SocialLinks,
  type UserSearchHit,
} from '@thegrave/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { avatarUrl, sniffImage } from '../../lib/avatar.js';
import { prisma } from '../../lib/prisma.js';
import { DEFAULT_RATING } from '../../rating/glicko2.js';
import type { Leaderboard } from '../../rating/leaderboard.js';
import { effectiveRd, PROVISIONAL_RD } from '../../rating/policy.js';

const pageQuery = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  scope: z.enum(['global', 'university']).default('global'),
});
const usernameParams = z.object({ username: z.string().min(1).max(20) });
const searchQuery = z.object({ q: z.string().max(20).default('') });
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
    const { offset, limit, scope } = pageQuery.parse(req.query);
    const viewerId = req.auth!.userId;
    const viewer = await prisma.user.findUnique({
      where: { id: viewerId },
      select: { institution: true },
    });
    if (scope === 'university')
      return leaderboard.pageForInstitution(viewer?.institution ?? null, offset, limit, viewerId);
    // The global board still tells the client which school the toggle would show.
    return {
      ...(await leaderboard.page(offset, limit, viewerId)),
      institution: viewer?.institution ?? null,
    };
  });

  // Navbar search (decision.md D-073): usernames starting with q, case-insensitive, best rated first.
  app.get('/search/users', async (req): Promise<UserSearchHit[]> => {
    const { q } = searchQuery.parse(req.query);
    const term = q.trim();
    if (!term) return [];
    const users = await prisma.user.findMany({
      where: { username: { startsWith: term, mode: 'insensitive' } },
      orderBy: [{ rating: 'desc' }, { username: 'asc' }],
      take: 8,
      select: { username: true, rating: true, avatarUpdatedAt: true },
    });
    return users.map((u) => ({
      username: u.username,
      rating: Math.round(u.rating),
      avatarUrl: avatarUrl(u),
    }));
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
      bio: user.bio,
      institution: user.institution,
      links: (user.links as SocialLinks | null) ?? {},
      avatarUrl: avatarUrl(user),
      peakRating: Math.round(
        Math.max(DEFAULT_RATING, user.rating, ...ordered.map((p) => p.ratingAfter)),
      ),
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
          select: {
            endReason: true,
            problem: { select: { title: true, difficulty: true } },
            // Programming battles (decision.md D-067) are about a codebase, not a problem.
            project: { select: { title: true, difficulty: true } },
          },
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
      problem: (r.match.problem ?? r.match.project)!,
    }));
    const last = page.at(-1);
    const body: MatchHistoryPage = {
      items,
      nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
    return body;
  });
}

/**
 * Profile editing (signed in) and avatars. Avatars are public: an <img> can't send the access token, and a
 * profile picture is meant to be seen.
 * Served with the sniffed type, nosniff and a long cache (the URL changes on every upload).
 */
export async function profileRoutes(app: FastifyInstance) {
  // ---- your own profile (decision.md D-071) ------------------------------------------------

  app.patch('/me/profile', { onRequest: app.authenticate }, async (req) => {
    const { bio, links } = profileUpdateSchema.parse(req.body);
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: req.auth!.userId },
      select: { links: true },
    });
    // Empty strings clear a link; untouched keys keep their value.
    const merged: SocialLinks = { ...((current.links as SocialLinks | null) ?? {}) };
    for (const [k, v] of Object.entries(links ?? {}) as [keyof SocialLinks, string | undefined][]) {
      if (v === undefined) continue;
      if (v === '') delete merged[k];
      else merged[k] = v;
    }
    await prisma.user.update({
      where: { id: req.auth!.userId },
      data: {
        ...(bio !== undefined && { bio: bio.trim() || null }),
        links: merged,
      },
    });
    return { ok: true };
  });

  app.put(
    '/me/avatar',
    {
      onRequest: app.authenticate,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { image } = avatarUploadSchema.parse(req.body);
      const data = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
      const mime = sniffImage(data);
      // The declared type is only a hint: the bytes must really be a PNG, JPEG or WebP (no SVG, no HTML).
      if (!mime || data.length > AVATAR_MAX_BYTES)
        return reply
          .code(400)
          .send({ error: 'Bad Request', message: 'Upload a PNG, JPEG or WebP under 256 KB' });
      const userId = req.auth!.userId;
      const now = new Date();
      await prisma.$transaction([
        prisma.avatar.upsert({
          where: { userId },
          create: { userId, data, mime },
          update: { data, mime },
        }),
        prisma.user.update({ where: { id: userId }, data: { avatarUpdatedAt: now } }),
      ]);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      return { avatarUrl: avatarUrl(user) };
    },
  );

  app.delete('/me/avatar', { onRequest: app.authenticate }, async (req) => {
    const userId = req.auth!.userId;
    await prisma.$transaction([
      prisma.avatar.deleteMany({ where: { userId } }),
      prisma.user.update({ where: { id: userId }, data: { avatarUpdatedAt: null } }),
    ]);
    return { ok: true };
  });

  app.get('/users/:username/avatar', async (req, reply) => {
    const { username } = usernameParams.parse(req.params);
    const user = await prisma.user.findUnique({
      where: { username },
      select: { avatar: { select: { data: true, mime: true } } },
    });
    if (!user?.avatar) return reply.code(404).send(notFound);
    return reply
      .header('Content-Type', user.avatar.mime)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('Content-Disposition', 'inline')
      .send(Buffer.from(user.avatar.data));
  });
}
