import { createAdapter } from '@socket.io/redis-adapter';
import {
  matchRoom,
  userRoom,
  type Ack,
  type AckError,
  type ClientToServerEvents,
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
  const mm: Matchmaker = new Matchmaker(
    redis,
    notifier,
    {
      localUserIds: () => [...io.of('/').sockets.values()].map((s) => s.data.user.id),
      onConfirmed: async (m) => {
        if (opts.onConfirmed) await opts.onConfirmed(m, mm);
        else await battle.createMatch(m);
      },
    },
    opts.matchmaker,
  );
  const leaderboard = new Leaderboard(redis);
  const battle = new BattleService(notifier, mm, leaderboard, {
    ...battleOptionsFromConfig(),
    ...opts.battle,
  });
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
    void resync(socket, mm, battle).catch((err) => app.log.error({ err }, 'resync failed'));

    socket.on('time:sync', (ack) => {
      if (typeof ack === 'function') ack({ serverNow: Date.now() });
    });

    socket.on('queue:join', (ack) =>
      handle(socket, ack, async () => {
        const res = await mm.join(userId);
        return res.ok
          ? { ok: true, joinedAt: res.joinedAt }
          : fail(res.code, 'You are already in a match');
      }),
    );
    socket.on('queue:leave', (ack) =>
      handle(socket, ack, async () =>
        (await mm.leave(userId)) ? { ok: true } : fail('NOT_QUEUED', 'You are not in the queue'),
      ),
    );
    socket.on('match:accept', (payload, ack) =>
      handle(socket, ack, async () =>
        (await mm.accept(String(payload?.matchId), userId))
          ? { ok: true }
          : fail('MATCH_NOT_FOUND', 'That match is no longer available'),
      ),
    );
    socket.on('match:decline', (payload, ack) =>
      handle(socket, ack, async () =>
        (await mm.decline(String(payload?.matchId), userId))
          ? { ok: true }
          : fail('MATCH_NOT_FOUND', 'That match is no longer available'),
      ),
    );

    socket.on('disconnect', async () => {
      if (shuttingDown) return;
      // Only leave the queue when this was the user's last socket on *any* node (multi-tab safe).
      // If the cluster-wide lookup fails, the queue lease expires on its own (D-035).
      try {
        const remaining = await io.in(userRoom(userId)).fetchSockets();
        if (remaining.length === 0) {
          await mm.leave(userId, 'disconnected');
          await battle.markAway(userId);
        }
      } catch (err) {
        app.log.warn({ err, userId }, 'could not check remaining sockets on disconnect');
      }
    });
  });

  mm.start();

  app.addHook('preClose', async () => {
    shuttingDown = true;
    await mm.stop();
    await battleWorker.close();
    await maintenance.then((m) => m.close()).catch(() => {});
    io.local.disconnectSockets(true);
  });
  app.addHook('onClose', async () => {
    await Promise.allSettled([pub.quit(), sub.quit()]);
  });

  return { io, matchmaker: mm, battle, leaderboard, maintenance };
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
async function resync(socket: GraveSocket, mm: Matchmaker, battle: BattleService) {
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
  const s = await mm.describe(socket.data.user.id);
  if (s.state === 'queued') socket.emit('queue:joined', { joinedAt: s.joinedAt });
  if (s.state === 'ready') {
    socket.emit('match:found', {
      matchId: s.matchId,
      opponent: s.opponent,
      expiresAt: s.expiresAt,
    });
  }
}
