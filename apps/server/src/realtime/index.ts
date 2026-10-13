import { createAdapter } from '@socket.io/redis-adapter';
import {
  userRoom,
  type Ack,
  type AckError,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@thegrave/shared';
import type { FastifyInstance } from 'fastify';
import { Server, type Socket } from 'socket.io';
import { config } from '../config.js';
import { redis } from '../lib/redis.js';
import { verifyAccessToken } from '../lib/tokens.js';
import {
  Matchmaker,
  type ConfirmedMatch,
  type MatchmakerOptions,
  type Notifier,
} from '../matchmaking/matchmaker.js';

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
  /**
   * What happens once both players accept. Phase 3 has no battle yet, so the default releases the
   * players straight away; Phase 4 replaces this with "create Match + start battle".
   */
  onConfirmed?: (match: ConfirmedMatch, mm: Matchmaker) => Promise<void> | void;
}

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

  const notifier: Notifier = {
    toUser: (userId, event, ...args) => io.to(userRoom(userId)).emit(event, ...args),
    broadcast: (event, ...args) => io.emit(event, ...args),
  };
  const mm: Matchmaker = new Matchmaker(
    redis,
    notifier,
    {
      localUserIds: () => [...io.of('/').sockets.values()].map((s) => s.data.user.id),
      onConfirmed: (m) =>
        opts.onConfirmed
          ? opts.onConfirmed(m, mm)
          : void mm.release(
              m.matchId,
              m.players.map((p) => p.id),
            ),
    },
    opts.matchmaker,
  );

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
    void resync(socket, mm).catch((err) => app.log.error({ err }, 'resync failed'));

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
        if (remaining.length === 0) await mm.leave(userId, 'disconnected');
      } catch (err) {
        app.log.warn({ err, userId }, 'could not check remaining sockets on disconnect');
      }
    });
  });

  mm.start();

  app.addHook('preClose', async () => {
    shuttingDown = true;
    await mm.stop();
    io.local.disconnectSockets(true);
  });
  app.addHook('onClose', async () => {
    await Promise.allSettled([pub.quit(), sub.quit()]);
  });

  return { io, matchmaker: mm };
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

/** A (re)connecting socket learns the user's current matchmaking state, e.g. after a page reload. */
async function resync(socket: GraveSocket, mm: Matchmaker) {
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
