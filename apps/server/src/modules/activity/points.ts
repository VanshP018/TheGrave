import {
  DIFFICULTY_POINTS,
  type ActivityDay,
  type ActivityView,
  type Difficulty,
  type LeaderboardScope,
  type PointsLeaderboardPage,
  type SolveKind,
  type SolvedBreakdown,
} from '@thegrave/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';

/** How many days the profile heat map covers. */
export const HEATMAP_DAYS = 371; // 53 whole weeks

const DAY_MS = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * One row per (player, problem) the player has solved, stamped with the time of their FIRST full pass:
 * a DSA problem is solved by an ACCEPTED submission (battle submissions count, they are judged the same
 * way), a programming challenge by a SUBMIT run that ran and passed the whole hidden suite
 * (`isFullPass`). Solving the same problem again earns nothing, so the row is unique per problem.
 */
const solves = (userId?: string) => Prisma.sql`
  SELECT s."userId" AS uid, 'DSA' AS kind, p.difficulty::text AS difficulty,
         MIN(COALESCE(s."finishedAt", s."createdAt")) AS solved_at
  FROM "Submission" s
  JOIN "Problem" p ON p.id = s."problemId"
  WHERE s.kind = 'SUBMIT' AND s.status = 'DONE' AND s.verdict = 'ACCEPTED'
    ${userId ? Prisma.sql`AND s."userId" = ${userId}::uuid` : Prisma.empty}
  GROUP BY s."userId", s."problemId", p.difficulty
  UNION ALL
  SELECT r."userId", 'PROGRAMMING', pr.difficulty::text,
         MIN(COALESCE(r."finishedAt", r."createdAt"))
  FROM "ProjectRun" r
  JOIN "Project" pr ON pr.id = r."projectId"
  WHERE r.kind = 'SUBMIT' AND r.status = 'DONE'
    AND r.total = pr."hiddenTestCount" AND r.passed = r.total
    ${userId ? Prisma.sql`AND r."userId" = ${userId}::uuid` : Prisma.empty}
  GROUP BY r."userId", r."projectId", pr.difficulty`;

const pointsSql = Prisma.sql`CASE difficulty
  WHEN 'EASY' THEN ${DIFFICULTY_POINTS.EASY}::int
  WHEN 'MEDIUM' THEN ${DIFFICULTY_POINTS.MEDIUM}::int
  ELSE ${DIFFICULTY_POINTS.HARD}::int END`;

/**
 * Everyone with at least one solve, ranked by points (competition ranking, ties share a rank). The school
 * filter is applied before ranking, so a school's board ranks its own players 1, 2, 3…
 */
const ranked = (institution: string | null) => Prisma.sql`
  WITH totals AS (
    SELECT uid,
           SUM(${pointsSql})::int AS points,
           COUNT(*)::int AS solved,
           COUNT(*) FILTER (WHERE kind = 'DSA')::int AS dsa,
           COUNT(*) FILTER (WHERE kind = 'PROGRAMMING')::int AS programming
    FROM (${solves()}) x
    GROUP BY uid
  ), ranked AS (
    SELECT t.uid, t.points, t.solved, t.dsa, t.programming, u.username, u.institution,
           RANK() OVER (ORDER BY t.points DESC)::int AS rank
    FROM totals t
    JOIN "User" u ON u.id = t.uid AND NOT u."isBot"
    ${institution === null ? Prisma.empty : Prisma.sql`WHERE lower(u.institution) = lower(${institution})`}
  )`;

interface RankedRow {
  uid: string;
  points: number;
  solved: number;
  dsa: number;
  programming: number;
  username: string;
  institution: string | null;
  rank: number;
}

/** The viewer's place on one board, or null if they have no points (or are outside the school). */
async function placeOf(userId: string, institution: string | null) {
  const rows = await prisma.$queryRaw<RankedRow[]>`
    ${ranked(institution)} SELECT * FROM ranked WHERE uid = ${userId}::uuid`;
  return rows[0] ?? null;
}

export async function pointsLeaderboard(opts: {
  scope: LeaderboardScope;
  viewerId: string;
  /** The viewer's school/college. */
  institution: string | null;
  offset: number;
  limit: number;
}): Promise<PointsLeaderboardPage> {
  const { scope, viewerId, institution, offset, limit } = opts;
  const filter = scope === 'university' ? institution : null;
  const empty: PointsLeaderboardPage = {
    scope,
    institution,
    total: 0,
    offset,
    entries: [],
    me: null,
  };
  // A campus board for someone with no school has nobody on it.
  if (scope === 'university' && institution === null) return empty;

  const [rows, me] = await Promise.all([
    prisma.$queryRaw<(RankedRow & { total: number })[]>`
      ${ranked(filter)}
      SELECT *, (SELECT COUNT(*) FROM ranked)::int AS total FROM ranked
      ORDER BY points DESC, solved DESC, username ASC
      LIMIT ${limit} OFFSET ${offset}`,
    placeOf(viewerId, filter),
  ]);
  return {
    scope,
    institution,
    // An offset past the end returns no rows; fall back to the viewer-independent count.
    total: rows[0]?.total ?? (offset > 0 ? await countRanked(filter) : 0),
    offset,
    entries: rows.map((r) => ({
      rank: r.rank,
      userId: r.uid,
      username: r.username,
      institution: r.institution,
      points: r.points,
      solved: r.solved,
      dsa: r.dsa,
      programming: r.programming,
    })),
    me: me ? { rank: me.rank, points: me.points } : null,
  };
}

async function countRanked(institution: string | null): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    ${ranked(institution)} SELECT COUNT(*)::int AS n FROM ranked`;
  return rows[0]?.n ?? 0;
}

const zero = (): SolvedBreakdown => ({ easy: 0, medium: 0, hard: 0 });
const bucket = (d: Difficulty) => d.toLowerCase() as keyof SolvedBreakdown;

/** A player's solved totals, heat map days and streaks, plus where they stand by points. */
export async function userActivity(
  userId: string,
  institution: string | null,
  now = new Date(),
): Promise<ActivityView> {
  const rows = await prisma.$queryRaw<
    { kind: SolveKind; difficulty: Difficulty; solved_at: Date }[]
  >`
    SELECT kind, difficulty, solved_at FROM (${solves(userId)}) x ORDER BY solved_at`;

  const dsa = zero();
  const programming = zero();
  const byDay = new Map<string, ActivityDay>();
  let points = 0;
  for (const r of rows) {
    const worth = DIFFICULTY_POINTS[r.difficulty];
    points += worth;
    (r.kind === 'DSA' ? dsa : programming)[bucket(r.difficulty)]++;
    const date = dayKey(r.solved_at);
    const day = byDay.get(date) ?? {
      date,
      dsaSolved: 0,
      dsaPoints: 0,
      programmingSolved: 0,
      programmingPoints: 0,
    };
    if (r.kind === 'DSA') {
      day.dsaSolved++;
      day.dsaPoints += worth;
    } else {
      day.programmingSolved++;
      day.programmingPoints += worth;
    }
    byDay.set(date, day);
  }

  // Streaks count consecutive UTC days with a solve. The current one survives until the end of the day
  // after the last solve, so a player who solved yesterday still sees their streak today.
  const dates = [...byDay.keys()].sort();
  let longestStreak = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of dates) {
    const t = Date.parse(d);
    run = prev !== null && t - prev === DAY_MS ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    prev = t;
  }
  const today = Date.parse(dayKey(now));
  const currentStreak = prev !== null && today - prev <= DAY_MS ? run : 0;

  const from = dayKey(new Date(today - (HEATMAP_DAYS - 1) * DAY_MS));
  const [global, university] = await Promise.all([
    points ? placeOf(userId, null) : null,
    points && institution ? placeOf(userId, institution) : null,
  ]);
  return {
    points,
    solved: rows.length,
    dsa,
    programming,
    days: dates.filter((d) => d >= from).map((d) => byDay.get(d)!),
    from,
    to: dayKey(now),
    activeDays: dates.length,
    currentStreak,
    longestStreak,
    rank: { global: global?.rank ?? null, university: university?.rank ?? null },
  };
}
