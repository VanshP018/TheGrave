import {
  matchRoom,
  type BattleView,
  type CodeSubmissionInput,
  type Difficulty,
  type MatchResult,
  type PlayerProgress,
  type ServerToClientEvents,
} from '@thegrave/shared';
import { enqueueSubmission } from '../judge/queue.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import type { ConfirmedMatch, Matchmaker, Notifier } from '../matchmaking/matchmaker.js';
import { applyMatchRating, toRatingChange } from '../rating/apply.js';
import type { Leaderboard } from '../rating/leaderboard.js';
import { markSeen, toProblemDetail } from '../modules/problems/detail.js';
import { decideOutcome, type Outcome } from './outcome.js';
import { difficultyFor, pickProblem } from './problem-pick.js';
import { scheduleBattleJob, type BattleJob } from './queue.js';

type Events = ServerToClientEvents;
export interface BattleNotifier extends Notifier {
  toRoom<E extends keyof Events>(room: string, event: E, ...args: Parameters<Events[E]>): void;
  /** Adds every socket of the user, on every node, to the room. */
  joinRoom(userId: string, room: string): void;
  /** Whether the user has a socket on any node right now. */
  isConnected(userId: string): Promise<boolean>;
}

export interface BattleOptions {
  countdownMs: number;
  durationMs: Record<Difficulty, number>;
  /** How long a disconnected player has to come back before forfeiting. */
  graceMs: number;
  submitCooldownMs: number;
  /** After endsAt, how long to wait for in-flight verdicts before deciding without them. */
  endGraceMs: number;
  endRecheckMs: number;
}

export const DEFAULT_BATTLE_OPTIONS: BattleOptions = {
  countdownMs: 5000,
  durationMs: { EASY: 15 * 60_000, MEDIUM: 25 * 60_000, HARD: 40 * 60_000 },
  graceMs: 30_000,
  submitCooldownMs: 5000,
  endGraceMs: 60_000,
  endRecheckMs: 2000,
};

export class BattleError extends Error {
  constructor(
    readonly statusCode: 404 | 409 | 429,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

const awayKey = (matchId: string, userId: string) => `battle:away:${matchId}:${userId}`;
const cooldownKey = (matchId: string, userId: string) => `battle:cooldown:${matchId}:${userId}`;
const LIVE = ['PENDING', 'ACTIVE'] as const;

/**
 * Battle lifecycle: PENDING → ACTIVE → FINISHED | ABORTED (decision.md D-040).
 * Every path that ends a match goes through `finish()`, a conditional update, so concurrent triggers
 * (an ACCEPTED verdict, the end timer and a forfeit landing at once) resolve to exactly one result.
 */
export class BattleService {
  readonly opts: BattleOptions;

  constructor(
    private readonly notify: BattleNotifier,
    private readonly mm: Matchmaker,
    private readonly leaderboard: Leaderboard,
    opts: Partial<BattleOptions> = {},
  ) {
    this.opts = { ...DEFAULT_BATTLE_OPTIONS, ...opts };
  }

  // ---- lifecycle ---------------------------------------------------------------------------

  async createMatch(confirmed: ConfirmedMatch): Promise<string> {
    const ids = confirmed.players.map((p) => p.id);
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, rating: true },
    });
    const avg = users.reduce((s, u) => s + u.rating, 0) / users.length;
    const problem = await pickProblem(ids, difficultyFor(avg));

    const startsAt = Date.now() + this.opts.countdownMs;
    const endsAt = startsAt + this.opts.durationMs[problem.difficulty];
    const match = await prisma.$transaction(async (tx) => {
      const m = await tx.match.create({
        data: {
          problemId: problem.id,
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          players: { create: users.map((u) => ({ userId: u.id, ratingBefore: u.rating })) },
        },
      });
      await tx.seenProblem.createMany({
        data: ids.map((userId) => ({ userId, problemId: problem.id })),
        skipDuplicates: true,
      });
      return m;
    });

    await this.mm.rebind(confirmed.matchId, match.id, ids);
    await scheduleBattleJob({ type: 'start', matchId: match.id }, startsAt - Date.now());
    await scheduleBattleJob({ type: 'end', matchId: match.id, attempt: 0 }, endsAt - Date.now());
    for (const id of ids) {
      this.notify.joinRoom(id, matchRoom(match.id));
      this.notify.toUser(id, 'battle:created', { matchId: match.id, startsAt, endsAt });
    }
    return match.id;
  }

  async handle(job: BattleJob): Promise<void> {
    switch (job.type) {
      case 'start':
        return this.start(job.matchId);
      case 'end':
        return this.end(job.matchId, job.attempt);
      case 'judged':
        return this.judged(job.matchId, job.submissionId);
      case 'forfeit':
        return this.forfeit(job.matchId, job.userId, job.token);
    }
  }

  private async start(matchId: string) {
    const { count } = await prisma.match.updateMany({
      where: { id: matchId, status: 'PENDING' },
      data: { status: 'ACTIVE' },
    });
    if (count) this.notify.toRoom(matchRoom(matchId), 'battle:started', { matchId });
  }

  private async end(matchId: string, attempt: number) {
    const giveUpOnPending = attempt * this.opts.endRecheckMs >= this.opts.endGraceMs;
    if ((await this.evaluate(matchId, giveUpOnPending)) === 'undecided') {
      // Time is up but verdicts are still in flight (or this node's clock is behind): check again shortly.
      await scheduleBattleJob(
        { type: 'end', matchId, attempt: attempt + 1 },
        this.opts.endRecheckMs,
      );
    }
  }

  private async judged(matchId: string, submissionId: string) {
    const sub = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: { userId: true },
    });
    if (!sub) return;
    this.notify.toUser(sub.userId, 'submission:judged', { matchId, submissionId });
    await this.emitProgress(matchId, sub.userId);
    await this.evaluate(matchId);
  }

  private async forfeit(matchId: string, userId: string, token: string) {
    // The token ties this job to one specific disconnect; reconnecting deletes it, cancelling the forfeit.
    if ((await redis.get(awayKey(matchId, userId))) !== token) return;
    // Ground truth beats event order: a reload's new socket can connect before the old one's
    // disconnect handler has finished marking the player away (decision.md D-044).
    if (await this.notify.isConnected(userId)) return this.clearAway(matchId, userId);
    const players = await prisma.matchPlayer.findMany({
      where: { matchId },
      select: { userId: true },
    });
    const opponent = players.find((p) => p.userId !== userId)?.userId;
    if (!opponent) return;
    const opponentAway =
      (await redis.exists(awayKey(matchId, opponent))) === 1 &&
      !(await this.notify.isConnected(opponent));
    await this.finish(
      matchId,
      opponentAway
        ? { status: 'ABORTED', winnerId: null, endReason: 'ABANDONED' }
        : { status: 'FINISHED', winnerId: opponent, endReason: 'FORFEIT' },
    );
  }

  private async clearAway(matchId: string, userId: string) {
    if (await redis.del(awayKey(matchId, userId))) await this.emitProgress(matchId, userId);
  }

  /** Applies the win rules to the current submissions; finishes the match if they decide it. */
  async evaluate(matchId: string, ignorePending = false): Promise<Outcome['kind'] | 'closed'> {
    const m = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        players: { select: { userId: true } },
        submissions: {
          select: {
            id: true,
            userId: true,
            createdAt: true,
            status: true,
            verdict: true,
            testsPassed: true,
          },
        },
      },
    });
    if (!m || !LIVE.includes(m.status as (typeof LIVE)[number])) return 'closed';
    const players = m.players.map((p) => p.userId) as [string, string];
    const outcome = decideOutcome(
      players,
      m.submissions
        .filter((s) => s.createdAt < m.endsAt)
        .map((s) => ({ ...s, createdAt: s.createdAt.getTime() })),
      { timeUp: Date.now() >= m.endsAt.getTime(), ignorePending },
    );
    if (outcome.kind === 'win') {
      await this.finish(matchId, {
        status: 'FINISHED',
        winnerId: outcome.winnerId,
        endReason: outcome.reason,
      });
    } else if (outcome.kind === 'draw') {
      await this.finish(matchId, { status: 'FINISHED', winnerId: null, endReason: 'TIMEOUT' });
    }
    return outcome.kind;
  }

  /**
   * The single exit from a live match. The status change and the Glicko-2 update commit together, so a
   * match can never be FINISHED but unrated (decision.md D-048). Returns false if someone else finished it.
   */
  async finish(matchId: string, result: MatchResult): Promise<boolean> {
    const outcome = await prisma.$transaction(async (tx) => {
      const { count } = await tx.match.updateMany({
        where: { id: matchId, status: { in: [...LIVE] } },
        data: {
          status: result.status,
          winnerId: result.winnerId,
          endReason: result.endReason,
          finishedAt: new Date(),
        },
      });
      if (!count) return null;
      const ids = (
        await tx.matchPlayer.findMany({ where: { matchId }, select: { userId: true } })
      ).map((p) => p.userId) as [string, string];
      const changes =
        result.status === 'FINISHED'
          ? await applyMatchRating(tx, matchId, ids, result.winnerId)
          : [];
      return { ids, changes };
    });
    if (!outcome) return false;

    await this.mm.release(matchId, outcome.ids);
    await redis.del(...outcome.ids.map((u) => awayKey(matchId, u)));
    // Derived state, updated after commit; a failure here is repaired by the next rebuild (D-050).
    await this.leaderboard.applyChanges(outcome.changes).catch(() => {});
    this.notify.toRoom(matchRoom(matchId), 'battle:finished', {
      matchId,
      result: { ...result, ratingChanges: outcome.changes.map(toRatingChange) },
    });
    return true;
  }

  // ---- presence ----------------------------------------------------------------------------

  /** The user's live match, if any. Self-heals a stale `match:` state left behind by a crash. */
  async currentMatch(userId: string): Promise<{ id: string; startsAt: Date; endsAt: Date } | null> {
    const state = await this.mm.describe(userId);
    if (state.state !== 'match') return null;
    const m = await prisma.match.findUnique({
      where: { id: state.matchId },
      select: { id: true, status: true, startsAt: true, endsAt: true },
    });
    if (!m || !LIVE.includes(m.status as (typeof LIVE)[number])) {
      if (m) await this.mm.release(m.id, [userId]);
      return null;
    }
    return m;
  }

  /** A socket of the user connected: cancel any pending forfeit and tell the opponent. */
  async markPresent(userId: string): Promise<string | null> {
    const m = await this.currentMatch(userId);
    if (!m) return null;
    await this.clearAway(m.id, userId);
    return m.id;
  }

  /** The user's last socket (cluster-wide) disconnected: start the reconnect grace period. */
  async markAway(userId: string): Promise<void> {
    const m = await this.currentMatch(userId);
    if (!m) return;
    const token = String(Date.now());
    await redis.set(awayKey(m.id, userId), token, 'PX', this.opts.graceMs + 60_000);
    await scheduleBattleJob({ type: 'forfeit', matchId: m.id, userId, token }, this.opts.graceMs);
    // A new socket may have connected while we were marking the old one away (e.g. a page reload).
    if (await this.notify.isConnected(userId)) return this.clearAway(m.id, userId);
    await this.emitProgress(m.id, userId);
  }

  // ---- submissions & views -----------------------------------------------------------------

  async submit(
    matchId: string,
    userId: string,
    input: CodeSubmissionInput,
  ): Promise<{ id: string }> {
    const m = await prisma.match.findUnique({ where: { id: matchId }, include: { players: true } });
    if (!m || !m.players.some((p) => p.userId === userId))
      throw new BattleError(404, 'Match not found');
    // The server clock decides, not the status column alone: the start job may lag by a few ms.
    const now = Date.now();
    if (
      !LIVE.includes(m.status as (typeof LIVE)[number]) ||
      now < m.startsAt.getTime() ||
      now >= m.endsAt.getTime()
    ) {
      throw new BattleError(409, 'The match is not running');
    }
    if (this.opts.submitCooldownMs > 0) {
      const key = cooldownKey(matchId, userId);
      if (!(await redis.set(key, '1', 'PX', this.opts.submitCooldownMs, 'NX'))) {
        throw new BattleError(
          429,
          'Wait a moment before submitting again',
          Math.max(0, await redis.pttl(key)),
        );
      }
    }
    const sub = await prisma.submission.create({
      data: {
        userId,
        matchId,
        problemId: m.problemId,
        kind: 'SUBMIT',
        language: input.language,
        code: input.code,
      },
    });
    await enqueueSubmission(sub.id);
    await markSeen([userId], m.problemId);
    await this.emitProgress(matchId, userId);
    return { id: sub.id };
  }

  async view(matchId: string, userId: string): Promise<BattleView> {
    const m = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        players: { include: { user: { select: { username: true } } } },
        problem: { include: { testCases: { orderBy: { ordinal: 'asc' } } } },
      },
    });
    if (!m || !m.players.some((p) => p.userId === userId))
      throw new BattleError(404, 'Match not found');

    const started = m.status !== 'PENDING' || Date.now() >= m.startsAt.getTime();
    const [players, mine] = await Promise.all([
      Promise.all(m.players.map((p) => this.progress(m.id, p.userId))),
      prisma.submission.findMany({ where: { matchId, userId }, orderBy: { createdAt: 'asc' } }),
    ]);
    // The viewer first, so clients can render "me vs them" without searching.
    players.sort((a, b) => (a.userId === userId ? -1 : b.userId === userId ? 1 : 0));
    return {
      id: m.id,
      status: m.status,
      startsAt: m.startsAt.getTime(),
      endsAt: m.endsAt.getTime(),
      serverNow: Date.now(),
      problem: started ? toProblemDetail(m.problem) : null,
      totalTests: started ? m.problem.testCases.length : null,
      players,
      mySubmissions: mine.map((s) => ({
        id: s.id,
        language: s.language,
        status: s.status,
        verdict: s.verdict,
        testsPassed: s.testsPassed,
        testsTotal: s.testsTotal,
        createdAt: s.createdAt.getTime(),
      })),
      submitCooldownMs: this.opts.submitCooldownMs,
      result:
        m.status === 'FINISHED' || m.status === 'ABORTED'
          ? {
              status: m.status,
              winnerId: m.winnerId,
              endReason: m.endReason!,
              ratingChanges: (await prisma.ratingHistory.findMany({ where: { matchId } })).map(
                (h) => ({
                  userId: h.userId,
                  before: Math.round(h.ratingBefore),
                  after: Math.round(h.ratingAfter),
                  delta: Math.round(h.ratingAfter) - Math.round(h.ratingBefore),
                }),
              ),
            }
          : null,
    };
  }

  /** Progress only: counts and best score, never code or test I/O. */
  async progress(matchId: string, userId: string): Promise<PlayerProgress> {
    const [player, subs, away] = await Promise.all([
      prisma.matchPlayer.findUniqueOrThrow({
        where: { matchId_userId: { matchId, userId } },
        include: { user: { select: { username: true } } },
      }),
      prisma.submission.findMany({
        where: { matchId, userId },
        select: { status: true, verdict: true, testsPassed: true },
      }),
      redis.get(awayKey(matchId, userId)),
    ]);
    return {
      userId,
      username: player.user.username,
      rating: Math.round(player.ratingBefore),
      attempts: subs.length,
      pending: subs.filter((s) => s.status === 'QUEUED' || s.status === 'RUNNING').length,
      bestPassed: subs.reduce((m, s) => Math.max(m, s.testsPassed ?? 0), 0),
      solved: subs.some((s) => s.verdict === 'ACCEPTED'),
      connected: away === null,
      graceEndsAt: away === null ? null : Number(away) + this.opts.graceMs,
    };
  }

  private async emitProgress(matchId: string, userId: string) {
    this.notify.toRoom(matchRoom(matchId), 'battle:progress', {
      matchId,
      player: await this.progress(matchId, userId),
    });
  }
}
