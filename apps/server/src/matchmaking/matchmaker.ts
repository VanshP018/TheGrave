import { randomUUID } from 'node:crypto';
import type { MatchMode, Opponent, QueueLeftReason, ServerToClientEvents } from '@thegrave/shared';
import type { Redis } from 'ioredis';
import { pickBotFor } from '../bots/plan.js';
import { prisma } from '../lib/prisma.js';
import { keysFor, queuedState, scripts } from './scripts.js';

export interface MatchmakerOptions {
  /** Which queue this instance runs; every mode has its own (decision.md D-067). */
  mode: MatchMode;
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
  /**
   * Practice bots: a player who has waited this long (plus up to a few seconds of jitter, so it isn't
   * clockwork) with no human opponent is paired with the roster bot closest in rating. `null` turns bots off.
   */
  botAfterMs: number | null;
  /** Up to this much extra waiting before a bot joins, different for every queue entry. */
  botJitterMs: number;
  maxBotPairsPerTick: number;
}

export const DEFAULT_MATCHMAKER_OPTIONS: MatchmakerOptions = {
  mode: 'DSA',
  windowBase: 50,
  windowStep: 25,
  windowStepMs: 5000,
  windowMax: 400,
  readyTimeoutMs: 10_000,
  leaseMs: 15_000,
  tickMs: 1000,
  maxPairsPerTick: 1000,
  matchStateTtlMs: 2 * 60 * 60 * 1000,
  botAfterMs: null,
  botJitterMs: 3000,
  maxBotPairsPerTick: 20,
};

/** Stable for one queue entry: spreads when bots join, so it is not a visible fixed delay. */
const jitterFor = (userId: string, joinedAt: number, maxMs: number) => {
  if (maxMs <= 0) return 0;
  let h = 2166136261;
  for (const c of `${userId}:${joinedAt}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) % maxMs;
};

type Events = ServerToClientEvents;
export interface Notifier {
  toUser<E extends keyof Events>(userId: string, event: E, ...args: Parameters<Events[E]>): void;
  broadcast<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): void;
}

export interface ConfirmedMatch {
  matchId: string;
  players: [Opponent, Opponent];
  mode: MatchMode;
}

export type JoinResult =
  | { ok: true; joinedAt: number; already: boolean }
  | { ok: false; code: 'ALREADY_IN_MATCH' | 'IN_ROOM' | 'IN_QUEUE' };

export type UserState =
  | { state: 'idle' }
  | { state: 'queued'; joinedAt: number }
  | { state: 'ready'; matchId: string; opponent: Opponent; expiresAt: number }
  | { state: 'match'; matchId: string }
  /** In a private room (decision.md D-065); rooms own this state, matchmaking only respects it. */
  | { state: 'room'; code: string };

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
    this.keys = keysFor(this.opts.mode);
    this.lockKey = this.opts.mode === 'DSA' ? 'mm:tick-lock' : 'mm:programming:tick-lock';
  }

  private readonly keys: string[];
  private readonly lockKey: string;
  private botCache: {
    at: number;
    bots: { id: string; username: string; rating: number }[];
  } | null = null;
  get mode(): MatchMode {
    return this.opts.mode;
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
    const [status, value] = await scripts.join.run<[string, string]>(
      this.redis,
      [userId, rating, this.opts.leaseMs],
      this.keys,
    );
    if (status === 'busy')
      return {
        ok: false,
        code: value.startsWith('room:')
          ? 'IN_ROOM'
          : value.startsWith('queued')
            ? 'IN_QUEUE'
            : 'ALREADY_IN_MATCH',
      };
    const joinedAt = Number(value);
    // Every tab of the user learns about it, not just the one that clicked.
    this.notify.toUser(userId, 'queue:joined', { joinedAt, mode: this.mode });
    return { ok: true, joinedAt, already: status === 'already' };
  }

  async leave(userId: string, reason: QueueLeftReason = 'requested'): Promise<boolean> {
    const removed = (await scripts.leave.run<number>(this.redis, [userId], this.keys)) === 1;
    if (removed) this.notify.toUser(userId, 'queue:left', { reason, mode: this.mode });
    return removed;
  }

  async accept(matchId: string, userId: string): Promise<boolean> {
    const res = await scripts.accept.run<string[]>(
      this.redis,
      [matchId, userId, this.opts.matchStateTtlMs],
      this.keys,
    );
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
      await this.hooks.onConfirmed({ matchId, players: [pa, pb], mode: this.mode });
    }
    return true;
  }

  async decline(matchId: string, userId: string): Promise<boolean> {
    const res = await scripts.decline.run<string[]>(
      this.redis,
      [matchId, userId, this.opts.leaseMs],
      this.keys,
    );
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
    return scripts.release.run<number>(this.redis, [matchId, ...userIds], this.keys);
  }

  /** Re-keys the players' `match:{readyId}` state to the persisted Match id, atomically. */
  async rebind(fromId: string, toId: string, userIds: string[]): Promise<number> {
    return scripts.rebind.run<number>(
      this.redis,
      [fromId, toId, this.opts.matchStateTtlMs, ...userIds],
      this.keys,
    );
  }

  async describe(userId: string): Promise<UserState> {
    const res = await scripts.describe.run<string[]>(this.redis, [userId], this.keys);
    const [st] = res;
    if (!st) return { state: 'idle' };
    if (st === queuedState(this.mode)) return { state: 'queued', joinedAt: Number(res[1]) };
    // The other mode's queue: not ours to describe.
    if (st.startsWith('queued')) return { state: 'idle' };
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
    if (st.startsWith('room:')) return { state: 'room', code: st.slice('room:'.length) };
    return { state: 'match', matchId: st.slice('match:'.length) };
  }

  /** Only one node per tick interval does the work; the Lua script is atomic regardless (D-034). */
  async tickWithLock(): Promise<boolean> {
    const got = await this.redis.set(
      this.lockKey,
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
    >(
      this.redis,
      [
        o.windowBase,
        o.windowStep,
        o.windowStepMs,
        o.windowMax,
        o.readyTimeoutMs,
        o.leaseMs,
        o.maxPairsPerTick,
        o.readyTimeoutMs + 60_000,
      ],
      this.keys,
    );

    for (const u of purged)
      this.notify.toUser(u, 'queue:left', { reason: 'expired', mode: this.mode });

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
        const mode = this.mode;
        this.notify.toUser(a, 'match:found', {
          matchId,
          opponent: players.get(b)!,
          expiresAt,
          mode,
        });
        this.notify.toUser(b, 'match:found', {
          matchId,
          opponent: players.get(a)!,
          expiresAt,
          mode,
        });
      }
    }

    const botPairs = await this.pairWithBots();
    return { purged, expired: expired.length, paired: pairs.length + botPairs, queued };
  }

  /** The roster, refreshed once a minute: the bots change only when the seed runs. */
  private async loadBots() {
    if (this.botCache && Date.now() - this.botCache.at < 60_000) return this.botCache.bots;
    const bots = await prisma.user.findMany({
      where: { isBot: true },
      select: { id: true, username: true, rating: true },
    });
    this.botCache = { at: Date.now(), bots };
    return bots;
  }

  /**
   * Gives a bot opponent to anyone who has waited long enough without finding a human. It is a normal
   * ready check in which the bot has already accepted, so the player sees the same "match found" step.
   * Humans are always matched first: the tick above has already paired everyone it could.
   */
  private async pairWithBots(): Promise<number> {
    const after = this.opts.botAfterMs;
    if (after === null) return 0;
    const [sec, micro] = await this.redis.time();
    const now = Number(sec) * 1000 + Math.floor(Number(micro) / 1000);
    const waiting = await this.redis.zrangebyscore(
      this.keys[1]!,
      '-inf',
      now - after,
      'WITHSCORES',
      'LIMIT',
      0,
      this.opts.maxBotPairsPerTick,
    );
    let paired = 0;
    for (let i = 0; i < waiting.length; i += 2) {
      const userId = waiting[i]!;
      const joinedAt = Number(waiting[i + 1]);
      if (now - joinedAt < after + jitterFor(userId, joinedAt, this.opts.botJitterMs)) continue;
      const rating = await this.redis.zscore(this.keys[0]!, userId);
      if (rating === null) continue;
      const bots = await this.loadBots();
      // Not the bots this player has just faced, if there are others nearly as close.
      const recentKey = `mm:bot-recent:${userId}`;
      const recent = new Set(await this.redis.lrange(recentKey, 0, 2));
      // The closest bot first; if it is busy in another match, the next closest.
      const tried = new Set<string>();
      for (let n = 0; n < 3; n++) {
        const bot = pickBotFor(
          bots.filter((b) => !tried.has(b.id)),
          Number(rating),
          Math.random,
          recent,
        );
        if (!bot) break;
        tried.add(bot.id);
        const res = await scripts.pairBot.run<string[]>(
          this.redis,
          [userId, bot.id, bot.rating, this.opts.readyTimeoutMs, this.opts.readyTimeoutMs + 60_000],
          this.keys,
        );
        if (!res.length) continue;
        const [matchId, , deadline] = res as [string, string, string];
        await this.redis
          .multi()
          .lpush(recentKey, bot.id)
          .ltrim(recentKey, 0, 2)
          .expire(recentKey, 24 * 60 * 60)
          .exec();
        this.notify.toUser(userId, 'match:found', {
          matchId,
          opponent: {
            id: bot.id,
            username: bot.username,
            rating: Math.round(bot.rating),
            bot: true,
          },
          expiresAt: Number(deadline),
          mode: this.mode,
        });
        paired++;
        break;
      }
    }
    return paired;
  }

  /** Renews queue leases for every user connected to this node. `XX` makes it a no-op for users not queued. */
  async renewLeases(): Promise<void> {
    const ids = [...new Set(this.hooks.localUserIds())];
    if (!ids.length) return;
    const [sec, micro] = await this.redis.time();
    const until = Number(sec) * 1000 + Math.floor(Number(micro) / 1000) + this.opts.leaseMs;
    await this.redis.zadd(this.keys[2]!, 'XX', ...ids.flatMap((id) => [until, id]));
  }

  private async opponents(entries: [string, number][]): Promise<Map<string, Opponent>> {
    const ids = [...new Set(entries.map(([id]) => id))];
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true, isBot: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return new Map(
      entries.map(([id, rating]) => [
        id,
        {
          id,
          username: byId.get(id)?.username ?? 'unknown',
          rating: Math.round(rating),
          ...(byId.get(id)?.isBot ? { bot: true } : {}),
        },
      ]),
    );
  }
}
