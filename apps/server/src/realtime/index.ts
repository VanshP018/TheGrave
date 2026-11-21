import { createAdapter } from '@socket.io/redis-adapter';
import {
  matchRoom,
  userRoom,
  type Ack,
  type AckError,
  type ClientToServerEvents,
  type MatchMode,
  type ServerToClientEvents,
} from '@thegrave/shared';
import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { config } from '../config.js';
import { createBattleWorker } from '../battle/worker.js';
import { BattleService, type BattleNotifier, type BattleOptions } from '../battle/service.js';
import { redis } from '../lib/redis.js';
import { verifyAccessToken } from '../lib/tokens.js';
import {
  Matchmaker,
  type ConfirmedMatch,
  type MatchmakerOptions,
} from '../matchmaking/matchmaker.js';
import { matchRoutes } from '../modules/matches/routes.js';
import { userRoutes } from '../modules/users/routes.js';
import { Leaderboard } from '../rating/leaderboard.js';
import { RoomService, type RoomOptions } from '../rooms/service.js';
import { startRatingMaintenance } from '../rating/maintenance.js';

interface SocketData {
  user: { id: string; username: string };
  /** Timestamps of recent events, for the per-socket rate limit. */
  recent: number[];
}
export type GraveServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type GraveSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const RATE_WINDOW_MS = 10_000;
const RATE_MAX_EVENTS = 30;

export interface RealtimeOptions {
  matchmaker?: Partial<MatchmakerOptions>;
  battle?: Partial<BattleOptions>;
  rooms?: Partial<RoomOptions>;
  /** What happens once both players accept. Defaults to starting a battle; tests may override. */
  onConfirmed?: (match: ConfirmedMatch, mm: Matchmaker) => Promise<void> | void;
}

const battleOptionsFromConfig = (): Partial<BattleOptions> => ({
  countdownMs: config.BATTLE_COUNTDOWN_MS,
  graceMs: config.BATTLE_RECONNECT_GRACE_MS,
  submitCooldownMs: config.BATTLE_SUBMIT_COOLDOWN_MS,
  ...(config.BATTLE_DURATION_MS
    ? {
        durationMs: {
          EASY: config.BATTLE_DURATION_MS,
          MEDIUM: config.BATTLE_DURATION_MS,
          HARD: config.BATTLE_DURATION_MS,
        },
      }
    : {}),
});

/**
 * Composition root for everything realtime: Socket.IO, matchmaking, battles (+ their HTTP routes and
 * job worker). Call after `buildApp()` and before `listen()`.
 */
export function attachRealtime(app: FastifyInstance, opts: RealtimeOptions = {}) {
  const pub = redis.duplicate();
  const sub = redis.duplicate();
  const io: GraveServer = new Server(app.server, {
    // WebSocket only: no long-polling, so no sticky sessions behind a load balancer (D-004).
    transports: ['websocket'],
    serveClient: false,
    cors: { origin: config.CORS_ORIGIN, credentials: true },
    adapter: createAdapter(pub, sub),
  });

  const notifier: BattleNotifier = {
    toUser: (userId, event, ...args) => io.to(userRoom(userId)).emit(event, ...args),
    toRoom: (room, event, ...args) => io.to(room).emit(event, ...args),
    broadcast: (event, ...args) => io.emit(event, ...args),
    joinRoom: (userId, room) => io.in(userRoom(userId)).socketsJoin(room),
    isConnected: async (userId) => (await io.in(userRoom(userId)).fetchSockets()).length > 0,
  };
  // Practice bots fill in for quiet hours; off in tests unless a test turns them on.
  const botsEnabled = config.BOTS_ENABLED ?? config.NODE_ENV !== 'test';
  // One queue per mode (decision.md D-067); both share the per-user state, so a player is in at most one.
  const makeMatchmaker = (mode: MatchMode): Matchmaker => {
    const instance: Matchmaker = new Matchmaker(
      redis,
      notifier,
      {
        localUserIds: () => [...io.of('/').sockets.values()].map((s) => s.data.user.id),
        onConfirmed: async (m) => {
          if (opts.onConfirmed) await opts.onConfirmed(m, instance);
          else await battle.createMatch(m);
        },
      },
      { botAfterMs: botsEnabled ? config.BOT_MATCH_AFTER_MS : null, ...opts.matchmaker, mode },
    );
    return instance;
  };
  const queues = { DSA: makeMatchmaker('DSA'), PROGRAMMING: makeMatchmaker('PROGRAMMING') };
  const mm = queues.DSA;
  const allQueues = Object.values(queues);
  /** Runs `fn` against each queue until one reports success (accept/decline/leave don't say which). */
  const anyQueue = async (fn: (q: Matchmaker) => Promise<boolean>) => {
    for (const q of allQueues) if (await fn(q)) return true;
    return false;
  };
  const leaderboard = new Leaderboard(redis);
  const battle = new BattleService(notifier, mm, leaderboard, {
    ...battleOptionsFromConfig(),
    ...opts.battle,
  });
  const rooms = new RoomService(redis, notifier, battle, mm, opts.rooms);
  const battleWorker = createBattleWorker(battle);
  const maintenance = startRatingMaintenance(leaderboard, { log: app.log });
  maintenance.catch((err) => app.log.error({ err }, 'rating maintenance failed to start'));
  void app.register(matchRoutes, { prefix: '/api', battle });
  void app.register(userRoutes, { prefix: '/api', leaderboard });

  // Handshake auth: the access JWT travels in the Socket.IO `auth` payload, never in the URL.
  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown }).token;
    try {
      if (typeof token !== 'string') throw new Error('missing token');
      const claims = verifyAccessToken(token);
      socket.data.user = { id: claims.sub, username: claims.username };
      socket.data.recent = [];
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  // During a graceful shutdown clients reconnect to another node; their lease keeps them queued meanwhile.
  let shuttingDown = false;

  io.on('connection', (socket) => {
    const userId = socket.data.user.id;
    void socket.join(userRoom(userId));
    void resync(socket, queues, battle, rooms).catch((err) =>
      app.log.error({ err }, 'resync failed'),
    );

    socket.on('time:sync', (ack) => {
      if (typeof ack === 'function') ack({ serverNow: Date.now() });
    });

    socket.on('queue:join', (...args: unknown[]) => {
      // `queue:join(ack)` is DSA; `queue:join({ mode }, ack)` picks the queue.
      const [payload, ack] = typeof args[0] === 'function' ? [undefined, args[0]] : args;
      const q =
        (payload as { mode?: MatchMode } | undefined)?.mode === 'PROGRAMMING'
          ? queues.PROGRAMMING
          : mm;
      return handle(socket, ack, async () => {
        const res = await q.join(userId);
        if (res.ok) return { ok: true, joinedAt: res.joinedAt };
        return res.code === 'IN_ROOM'
          ? fail('IN_ROOM', 'Leave your private room before queueing')
          : res.code === 'IN_QUEUE'
            ? fail('IN_QUEUE', 'You are already queued for the other mode')
            : fail(res.code, 'You are already in a match');
      });
    });
    socket.on('queue:leave', (ack) =>
      handle(socket, ack, async () =>
        (await anyQueue((q) => q.leave(userId)))
          ? { ok: true }
          : fail('NOT_QUEUED', 'You are not in the queue'),
      ),
    );
    socket.on('match:accept', (payload, ack) =>
      handle(socket, ack, async () =>
        (await anyQueue((q) => q.accept(String(payload?.matchId), userId)))
          ? { ok: true }
          : fail('MATCH_NOT_FOUND', 'That match is no longer available'),
      ),
    );
    socket.on('match:decline', (payload, ack) =>
      handle(socket, ack, async () =>
        (await anyQueue((q) => q.decline(String(payload?.matchId), userId)))
          ? { ok: true }
          : fail('MATCH_NOT_FOUND', 'That match is no longer available'),
      ),
    );

    socket.on('room:create', (...args: unknown[]) => {
      const [payload, ack] = typeof args[0] === 'function' ? [undefined, args[0]] : args;
      const mode = (payload as { mode?: MatchMode } | undefined)?.mode ?? 'DSA';
      return handle(socket, ack, () => rooms.create(userId, mode));
    });
    socket.on('room:join', (payload, ack) =>
      handle(socket, ack, () => rooms.join(userId, String(payload?.code ?? ''))),
    );
    socket.on('room:leave', (ack) =>
      handle(socket, ack, async () =>
        (await rooms.leave(userId))
          ? { ok: true }
          : fail('ROOM_NOT_FOUND', 'You are not in a room'),
      ),
    );
    socket.on('room:update', (payload, ack) =>
      handle(socket, ack, () => rooms.update(userId, payload ?? {})),
    );
    socket.on('room:start', (ack) => handle(socket, ack, () => rooms.start(userId)));

    socket.on('disconnect', async () => {
      if (shuttingDown) return;
      // Only leave the queue when this was the user's last socket on *any* node (multi-tab safe).
      // If the cluster-wide lookup fails, the queue lease expires on its own (D-035).
      try {
        const remaining = await io.in(userRoom(userId)).fetchSockets();
        if (remaining.length === 0) {
          for (const q of allQueues) await q.leave(userId, 'disconnected');
          await battle.markAway(userId);
          rooms.scheduleLeave(userId);
        }
      } catch (err) {
        app.log.warn({ err, userId }, 'could not check remaining sockets on disconnect');
      }
    });
  });

  for (const q of allQueues) q.start();

  app.addHook('preClose', async () => {
    shuttingDown = true;
    await Promise.all(allQueues.map((q) => q.stop()));
    rooms.stop();
    await battleWorker.close();
    await maintenance.then((m) => m.close()).catch(() => {});
    io.local.disconnectSockets(true);
  });
  app.addHook('onClose', async () => {
    await Promise.allSettled([pub.quit(), sub.quit()]);
  });

  return { io, matchmaker: mm, queues, battle, rooms, leaderboard, maintenance };
}

const fail = (code: AckError, message: string): Ack => ({ ok: false, code, message });

async function handle<T extends Ack>(socket: GraveSocket, ack: unknown, fn: () => Promise<T>) {
  const reply = typeof ack === 'function' ? (ack as (res: Ack) => void) : () => {};
  const now = Date.now();
  const recent = socket.data.recent.filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  socket.data.recent = recent;
  if (recent.length > RATE_MAX_EVENTS) return reply(fail('RATE_LIMITED', 'Slow down'));
  try {
    reply(await fn());
  } catch {
    reply(fail('INTERNAL', 'Something went wrong'));
  }
}

/** A (re)connecting socket learns the user's current matchmaking/battle state, e.g. after a page reload. */
async function resync(
  socket: GraveSocket,
  queues: Record<MatchMode, Matchmaker>,
  battle: BattleService,
  rooms: RoomService,
) {
  const match = await battle.currentMatch(socket.data.user.id);
  if (match) {
    await socket.join(matchRoom(match.id));
    await battle.markPresent(socket.data.user.id);
    socket.emit('battle:created', {
      matchId: match.id,
      startsAt: match.startsAt.getTime(),
      endsAt: match.endsAt.getTime(),
    });
    return;
  }
  const room = await rooms.current(socket.data.user.id);
  if (room) {
    socket.emit('room:updated', room);
    return;
  }
  for (const [mode, q] of Object.entries(queues) as [MatchMode, Matchmaker][]) {
    const s = await q.describe(socket.data.user.id);
    if (s.state === 'queued') socket.emit('queue:joined', { joinedAt: s.joinedAt, mode });
    if (s.state === 'ready') {
      socket.emit('match:found', {
        matchId: s.matchId,
        opponent: s.opponent,
        expiresAt: s.expiresAt,
        mode,
      });
    }
  }
}
