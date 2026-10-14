import { randomUUID } from 'node:crypto';
import type { Opponent, QueueLeftReason, ServerToClientEvents } from '@thegrave/shared';
import type { Redis } from 'ioredis';
import { prisma } from '../lib/prisma.js';
import { scripts } from './scripts.js';

export interface MatchmakerOptions {
  /** Rating window: ±base, widening by `step` every `stepMs` of waiting, capped at ±max. */
  windowBase: number;
  windowStep: number;
  windowStepMs: number;
  windowMax: number;
  readyTimeoutMs: number;
  /** A queue entry is purged if no node renews its lease for this long. */
  leaseMs: number;
  tickMs: number;
  maxPairsPerTick: number;
  /** Safety-net TTL on `user:{id}:state = match:{id}` in case a match is never released. */
  matchStateTtlMs: number;
}

export const DEFAULT_MATCHMAKER_OPTIONS: MatchmakerOptions = {
  windowBase: 50,
  windowStep: 25,
  windowStepMs: 5000,
  windowMax: 400,
  readyTimeoutMs: 10_000,
  leaseMs: 15_000,
  tickMs: 1000,
  maxPairsPerTick: 1000,
  matchStateTtlMs: 2 * 60 * 60 * 1000,
};

type Events = ServerToClientEvents;
export interface Notifier {
  toUser<E extends keyof Events>(userId: string, event: E, ...args: Parameters<Events[E]>): void;
  broadcast<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): void;
}

export interface ConfirmedMatch {
  matchId: string;
  players: [Opponent, Opponent];
}

export type JoinResult =
  { ok: true; joinedAt: number; already: boolean } | { ok: false; code: 'ALREADY_IN_MATCH' };

export type UserState =
  | { state: 'idle' }
  | { state: 'queued'; joinedAt: number }
  | { state: 'ready'; matchId: string; opponent: Opponent; expiresAt: number }
  | { state: 'match'; matchId: string };

const LOCK_KEY = 'mm:tick-lock';

export class Matchmaker {
  readonly nodeId = randomUUID();
  readonly opts: MatchmakerOptions;
  private timers: NodeJS.Timeout[] = [];
  private inflight = new Set<Promise<unknown>>();

  constructor(
    private readonly redis: Redis,
    private readonly notify: Notifier,
    private readonly hooks: {
      /** User ids with a socket on this node; their queue leases are renewed by this node. */
      localUserIds: () => Iterable<string>;
      /** Called once per confirmed match (on the node that saw the second accept). */
      onConfirmed: (match: ConfirmedMatch) => Promise<void> | void;
    },
    opts: Partial<MatchmakerOptions> = {},
  ) {
    this.opts = { ...DEFAULT_MATCHMAKER_OPTIONS, ...opts };
  }

  start() {
    const every = (ms: number, fn: () => Promise<unknown>) =>
      this.timers.push(
        setInterval(() => {
          const p = fn().catch(() => {});
          this.inflight.add(p);
          void p.finally(() => this.inflight.delete(p));
        }, ms),
      );
    every(this.opts.tickMs, () => this.tickWithLock());
    every(Math.max(100, this.opts.leaseMs / 3), () => this.renewLeases());
  }

  /** Stops the timers and waits for an in-flight tick/renewal, so Redis can be closed safely afterwards. */
  async stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
    await Promise.allSettled([...this.inflight]);
  }

  async join(userId: string): Promise<JoinResult> {
    // Rating comes from the database, never from the client.
    const { rating } = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { rating: true },
    });
    const [status, value] = await scripts.join.run<[string, string]>(this.redis, [
      userId,
      rating,
      this.opts.leaseMs,
    ]);
    if (status === 'busy') return { ok: false, code: 'ALREADY_IN_MATCH' };
    const joinedAt = Number(value);
    // Every tab of the user learns about it, not just the one that clicked.
    this.notify.toUser(userId, 'queue:joined', { joinedAt });
    return { ok: true, joinedAt, already: status === 'already' };
  }

  async leave(userId: string, reason: QueueLeftReason = 'requested'): Promise<boolean> {
    const removed = (await scripts.leave.run<number>(this.redis, [userId])) === 1;
    if (removed) this.notify.toUser(userId, 'queue:left', { reason });
    return removed;
  }

  async accept(matchId: string, userId: string): Promise<boolean> {
    const res = await scripts.accept.run<string[]>(this.redis, [
      matchId,
      userId,
      this.opts.matchStateTtlMs,
    ]);
    if (res[0] === 'gone') return false;
    const [, a, b, ra, rb] = res as [string, string, string, string?, string?];
    for (const u of [a, b]) this.notify.toUser(u, 'match:accepted', { matchId, userId });
    if (res[0] === 'confirmed') {
      const players = await this.opponents([
        [a, Number(ra)],
        [b, Number(rb)],
      ]);
      const [pa, pb] = [players.get(a)!, players.get(b)!];
      this.notify.toUser(a, 'match:confirmed', { matchId, opponent: pb });
      this.notify.toUser(b, 'match:confirmed', { matchId, opponent: pa });
      await this.hooks.onConfirmed({ matchId, players: [pa, pb] });
    }
    return true;
  }

  async decline(matchId: string, userId: string): Promise<boolean> {
    const res = await scripts.decline.run<string[]>(this.redis, [
      matchId,
      userId,
      this.opts.leaseMs,
    ]);
    if (res[0] === 'gone') return false;
    const [, other, requeued] = res as [string, string, number];
    this.notify.toUser(userId, 'match:cancelled', { matchId, reason: 'declined', requeued: false });
    this.notify.toUser(other, 'match:cancelled', {
      matchId,
      reason: 'declined',
      requeued: requeued === 1,
    });
    return true;
  }

  /** Clears `match:{id}` state so the players can queue again (Phase 4 calls this when a battle ends). */
  async release(matchId: string, userIds: string[]): Promise<number> {
    return scripts.release.run<number>(this.redis, [matchId, ...userIds]);
  }

  /** Re-keys the players' `match:{readyId}` state to the persisted Match id, atomically. */
  async rebind(fromId: string, toId: string, userIds: string[]): Promise<number> {
    return scripts.rebind.run<number>(this.redis, [
      fromId,
      toId,
      this.opts.matchStateTtlMs,
      ...userIds,
    ]);
  }

  async describe(userId: string): Promise<UserState> {
    const res = await scripts.describe.run<string[]>(this.redis, [userId]);
    const [st] = res;
    if (!st) return { state: 'idle' };
    if (st === 'queued') return { state: 'queued', joinedAt: Number(res[1]) };
    if (st.startsWith('ready:')) {
      const [, id, a, b, ra, rb, deadline] = res as string[];
      if (!a || !deadline) return { state: 'idle' };
      const players = await this.opponents([
        [a, Number(ra)],
        [b!, Number(rb)],
      ]);
      const opponent = players.get(a === userId ? b! : a)!;
      return { state: 'ready', matchId: id!, opponent, expiresAt: Number(deadline) };
    }
    return { state: 'match', matchId: st.slice('match:'.length) };
  }

  /** Only one node per tick interval does the work; the Lua script is atomic regardless (D-034). */
  async tickWithLock(): Promise<boolean> {
    const got = await this.redis.set(
      LOCK_KEY,
      this.nodeId,
      'PX',
      Math.max(50, this.opts.tickMs - 50),
      'NX',
    );
    if (!got) return false;
    await this.tick();
    return true;
  }

  async tick(): Promise<{ purged: string[]; expired: number; paired: number; queued: number }> {
    const o = this.opts;
    const [purged, expired, pairs, queued] = await scripts.tick.run<
      [
        string[],
        [string, string, string, string, string][],
        [string, string, string, string, string, string][],
        number,
      ]
    >(this.redis, [
      o.windowBase,
      o.windowStep,
      o.windowStepMs,
      o.windowMax,
      o.readyTimeoutMs,
      o.leaseMs,
      o.maxPairsPerTick,
      o.readyTimeoutMs + 60_000,
    ]);

    for (const u of purged) this.notify.toUser(u, 'queue:left', { reason: 'expired' });

    for (const [matchId, a, accA, b, accB] of expired) {
      this.notify.toUser(a, 'match:cancelled', {
        matchId,
        reason: 'timeout',
        requeued: accA === '1',
      });
      this.notify.toUser(b, 'match:cancelled', {
        matchId,
        reason: 'timeout',
        requeued: accB === '1',
      });
    }

    if (pairs.length) {
      const players = await this.opponents(
        pairs.flatMap(([, a, ra, b, rb]) => [
          [a, Number(ra)],
          [b, Number(rb)],
        ]),
      );
      for (const [matchId, a, , b, , deadline] of pairs) {
        const expiresAt = Number(deadline);
        this.notify.toUser(a, 'match:found', { matchId, opponent: players.get(b)!, expiresAt });
        this.notify.toUser(b, 'match:found', { matchId, opponent: players.get(a)!, expiresAt });
      }
    }

    this.notify.broadcast('queue:stats', { queued });
    return { purged, expired: expired.length, paired: pairs.length, queued };
  }

  /** Renews queue leases for every user connected to this node. `XX` makes it a no-op for users not queued. */
  async renewLeases(): Promise<void> {
    const ids = [...new Set(this.hooks.localUserIds())];
    if (!ids.length) return;
    const [sec, micro] = await this.redis.time();
    const until = Number(sec) * 1000 + Math.floor(Number(micro) / 1000) + this.opts.leaseMs;
    await this.redis.zadd('mm:lease', 'XX', ...ids.flatMap((id) => [until, id]));
  }

  private async opponents(entries: [string, number][]): Promise<Map<string, Opponent>> {
    const ids = [...new Set(entries.map(([id]) => id))];
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true },
    });
    const names = new Map(users.map((u) => [u.id, u.username]));
    return new Map(
      entries.map(([id, rating]) => [
        id,
        { id, username: names.get(id) ?? 'unknown', rating: Math.round(rating) },
      ]),
    );
  }
}
