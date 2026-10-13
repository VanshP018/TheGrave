import type { ClientToServerEvents, ServerToClientEvents } from '@thegrave/shared';
import type { FastifyInstance } from 'fastify';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { redis } from '../src/lib/redis.js';
import { signAccessToken } from '../src/lib/tokens.js';
import type { ConfirmedMatch } from '../src/matchmaking/matchmaker.js';
import { attachRealtime } from '../src/realtime/index.js';
import { resetState } from './helpers.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
type Behaviour = 'good' | 'decliner' | 'afk';

const N = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const createRng = (seed: number) => () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

interface Player {
  id: string;
  rating: number;
  behaviour: Behaviour;
  sockets: Client[];
  found: { matchId: string; opponentId: string; opponentRating: number }[];
  active: string | null; // unresolved ready check
  confirmed: string[];
  violations: string[];
}

const nodes: FastifyInstance[] = [];
const serverConfirmed: ConfirmedMatch[] = [];
const players: Player[] = [];

beforeAll(async () => {
  await resetState();
  const rand = createRng(42);
  await prisma.user.createMany({
    data: Array.from({ length: N }, (_, i) => ({
      username: `bot${i}`,
      email: `bot${i}@x.io`,
      passwordHash: 'x',
      rating: Math.round(1000 + rand() * 1000),
    })),
  });

  // Two API nodes sharing Redis: pairing happens on whichever holds the tick lock,
  // events reach sockets on either node through the Redis adapter.
  for (let k = 0; k < 2; k++) {
    const app = await buildApp();
    attachRealtime(app, {
      matchmaker: { tickMs: 100, windowStepMs: 300, readyTimeoutMs: 1500, leaseMs: 3000 },
      onConfirmed: async (m, mm) => {
        serverConfirmed.push(m);
        await mm.release(
          m.matchId,
          m.players.map((p) => p.id),
        );
      },
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    nodes.push(app);
  }
});

afterAll(async () => {
  for (const p of players) p.sockets.forEach((s) => s.disconnect());
  for (const app of nodes) await app.close();
  await Promise.all([prisma.$disconnect(), redis.quit()]);
});

const url = (k: number) => {
  const addr = nodes[k]!.server.address();
  return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
};

function openSocket(p: Player, node: number): Promise<Client> {
  const token = signAccessToken({ sub: p.id, username: p.id });
  const s: Client = connect(url(node), {
    transports: ['websocket'],
    auth: { token },
    forceNew: true,
    reconnection: false,
  });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

describe(`${N} simulated clients across 2 nodes`, () => {
  it('rejects a socket without a valid token', async () => {
    const s = connect(url(0), {
      transports: ['websocket'],
      auth: { token: 'garbage' },
      forceNew: true,
      reconnection: false,
    });
    const err = await new Promise<Error>((resolve) => s.once('connect_error', resolve));
    expect(err.message).toBe('unauthorized');
    s.close();
  });

  it('no double matches, no orphaned state, fair rating spread', async () => {
    const users = await prisma.user.findMany({
      select: { id: true, rating: true },
      orderBy: { username: 'asc' },
    });
    users.forEach((u, i) => {
      const behaviour: Behaviour = i % 20 === 0 ? 'decliner' : i % 20 === 1 ? 'afk' : 'good';
      players.push({
        id: u.id,
        rating: u.rating,
        behaviour,
        sockets: [],
        found: [],
        active: null,
        confirmed: [],
        violations: [],
      });
    });

    await Promise.all(
      players.map(async (p, i) => {
        const main = await openSocket(p, i % 2);
        p.sockets.push(main);
        // Every 10th player has a second tab on the other node.
        if (i % 10 === 3) p.sockets.push(await openSocket(p, (i + 1) % 2));

        main.on('match:found', ({ matchId, opponent }) => {
          if (p.active && p.active !== matchId)
            p.violations.push(`found ${matchId} while in ${p.active}`);
          if (p.found.some((f) => f.matchId === matchId)) return; // resync duplicate
          p.active = matchId;
          p.found.push({ matchId, opponentId: opponent.id, opponentRating: opponent.rating });
          if (p.behaviour === 'good') main.emit('match:accept', { matchId }, () => {});
          if (p.behaviour === 'decliner') main.emit('match:decline', { matchId }, () => {});
        });
        main.on('match:confirmed', ({ matchId }) => {
          p.confirmed.push(matchId);
          if (p.active === matchId) p.active = null;
        });
        main.on('match:cancelled', ({ matchId }) => {
          if (p.active === matchId) p.active = null;
        });
      }),
    );

    // Join storm: every player double-clicks, and second tabs join too.
    await Promise.all(
      players.flatMap((p) =>
        [...p.sockets, p.sockets[0]!].map(
          (s) => new Promise((resolve) => s.emit('queue:join', resolve)),
        ),
      ),
    );

    const good = players.filter((p) => p.behaviour === 'good');
    const deadline = Date.now() + 30_000;
    for (;;) {
      const queued = await redis.zcard('mm:queue');
      const pendingReady = await redis.zcard('mm:ready:deadlines');
      const settled =
        good.every((p) => p.confirmed.length > 0) || (queued <= 1 && pendingReady === 0);
      if (settled || Date.now() > deadline) break;
      await sleep(100);
    }

    // 1. No double matches.
    expect(players.flatMap((p) => p.violations)).toEqual([]);
    const byMatch = new Map<string, string[]>();
    for (const p of players)
      for (const f of p.found) byMatch.set(f.matchId, [...(byMatch.get(f.matchId) ?? []), p.id]);
    for (const [matchId, ids] of byMatch) {
      expect(ids, matchId).toHaveLength(2);
      const [x, y] = ids.map((id) => players.find((p) => p.id === id)!);
      expect(x!.found.find((f) => f.matchId === matchId)!.opponentId).toBe(y!.id);
      expect(y!.found.find((f) => f.matchId === matchId)!.opponentId).toBe(x!.id);
    }
    const confirmedUsers = serverConfirmed.flatMap((m) => m.players.map((p) => p.id));
    expect(new Set(confirmedUsers).size).toBe(confirmedUsers.length);
    for (const p of players) expect(p.confirmed.length).toBeLessThanOrEqual(1);

    // Only players who accepted ever get confirmed; everyone good is confirmed or still waiting.
    for (const p of players.filter((x) => x.behaviour !== 'good')) expect(p.confirmed).toEqual([]);
    const unconfirmed = good.filter((p) => p.confirmed.length === 0);
    for (const p of unconfirmed) expect(await redis.zscore('mm:queue', p.id)).not.toBeNull();
    expect(unconfirmed.length).toBeLessThanOrEqual(2);

    // 3. Fair spread: every pairing respects the ±400 cap and is tight on average.
    const diffs = serverConfirmed
      .map((m) => Math.abs(m.players[0].rating - m.players[1].rating))
      .sort((a, b) => a - b);
    const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
    const p90 = diffs[Math.floor(diffs.length * 0.9)]!;
    console.log(
      `matches=${serverConfirmed.length} readyChecks=${byMatch.size} ratingDiff mean=${mean.toFixed(1)} p90=${p90} max=${diffs.at(-1)}`,
    );
    expect(serverConfirmed.length).toBeGreaterThanOrEqual(88);
    expect(diffs.at(-1)!).toBeLessThanOrEqual(400);
    expect(mean).toBeLessThan(25);
    expect(p90).toBeLessThanOrEqual(50);

    // 2. No orphans: once everyone disconnects, Redis holds no matchmaking state at all.
    for (const p of players) p.sockets.forEach((s) => s.disconnect());
    await sleep(500);
    await redis.del('mm:tick-lock');
    expect(await redis.zcard('mm:queue')).toBe(0);
    expect(await redis.zcard('mm:joined')).toBe(0);
    expect(await redis.zcard('mm:lease')).toBe(0);
    expect(await redis.zcard('mm:ready:deadlines')).toBe(0);
    expect(await redis.keys('user:*:state')).toEqual([]);
    expect(await redis.keys('mm:ready:[0-9]*')).toEqual([]);
  });
});
