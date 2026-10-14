import type {
  BattleView,
  ClientToServerEvents,
  PlayerProgress,
  ServerToClientEvents,
} from '@thegrave/shared';
import type { Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { pickProblem } from '../src/battle/problem-pick.js';
import { battleQueue } from '../src/battle/queue.js';
import type { BattleOptions } from '../src/battle/service.js';
import { summarise, type Executor } from '../src/judge/executor.js';
import { submissionsQueue } from '../src/judge/queue.js';
import { createJudgeWorker } from '../src/judge/worker.js';
import { prisma } from '../src/lib/prisma.js';
import { redis } from '../src/lib/redis.js';
import { signAccessToken } from '../src/lib/tokens.js';
import { attachRealtime } from '../src/realtime/index.js';
import { buildTestCases, STARTER_CODE } from '../src/seed/build.js';
import { problems } from '../src/seed/problems.js';
import { resetState } from './helpers.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BATTLE: Partial<BattleOptions> = {
  countdownMs: 500,
  durationMs: { EASY: 1500, MEDIUM: 1500, HARD: 1500 },
  graceMs: 400,
  submitCooldownMs: 300,
  endGraceMs: 2000,
  endRecheckMs: 100,
};

/** Scripted judge: `AC` passes all, `PASS:n` passes n, a `SLOW:ms;` prefix delays the verdict. */
const fakeExecutor: Executor = {
  async run(_lang, code, tests) {
    const slow = code.match(/^SLOW:(\d+);/);
    if (slow) await sleep(Number(slow[1]));
    const c = code.replace(/^SLOW:\d+;/, '');
    const n = c === 'AC' ? tests.length : c.startsWith('PASS:') ? Number(c.slice(5)) : 0;
    return summarise(
      tests.map((_, index) => ({
        index,
        verdict: index < n ? 'ACCEPTED' : 'WRONG_ANSWER',
        timeMs: 1,
        stdout: '',
        stderr: '',
      })),
      null,
    );
  },
};

let app: FastifyInstance;
let rt: ReturnType<typeof attachRealtime>;
let judge: Worker;
let url: string;
const sockets: Client[] = [];
let userSeq = 0;

async function start(opts: Partial<BattleOptions> = BATTLE) {
  app = await buildApp();
  rt = attachRealtime(app, { matchmaker: { tickMs: 100 }, battle: opts });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}

beforeAll(async () => {
  await resetState();
  const def = problems.find((p) => p.slug === 'sum-of-array')!;
  await prisma.problem.create({
    data: {
      slug: def.slug,
      title: def.title,
      difficulty: def.difficulty,
      statement: def.statement,
      starterCode: STARTER_CODE,
      testCases: { create: buildTestCases(def) },
    },
  });
  await start();
  judge = createJudgeWorker(fakeExecutor, { concurrency: 4 });
});

afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await judge.close();
  await app.close();
  await Promise.all([submissionsQueue.close(), battleQueue.close()]);
  await Promise.all([prisma.$disconnect(), redis.quit()]);
});

interface TestUser {
  id: string;
  username: string;
  auth: { authorization: string };
  socket: Client;
}

async function user(): Promise<TestUser> {
  const username = `fighter${userSeq++}`;
  const u = await prisma.user.create({
    data: { username, email: `${username}@x.io`, passwordHash: 'x' },
  });
  const token = signAccessToken({ sub: u.id, username });
  return {
    id: u.id,
    username,
    auth: { authorization: `Bearer ${token}` },
    socket: await openSocket(token),
  };
}

function openSocket(token: string): Promise<Client> {
  const s: Client = connect(url, {
    transports: ['websocket'],
    auth: { token },
    forceNew: true,
    reconnection: false,
  });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

function next<E extends keyof ServerToClientEvents>(
  s: Client,
  event: E,
  match: (...args: Parameters<ServerToClientEvents[E]>) => boolean = () => true,
  timeoutMs = 5000,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    const handler = (...args: Parameters<ServerToClientEvents[E]>) => {
      if (!match(...args)) return;
      clearTimeout(t);
      s.off(event, handler as never);
      resolve(args[0]);
    };
    s.on(event, handler as never);
  });
}

/** Two players go through the real queue + ready check, as a client would. */
async function matchUp(): Promise<{ a: TestUser; b: TestUser; matchId: string }> {
  const [a, b] = [await user(), await user()];
  const found = Promise.all([next(a.socket, 'match:found'), next(b.socket, 'match:found')]);
  for (const u of [a, b]) u.socket.emit('queue:join', () => {});
  const [fa] = await found;
  const created = next(a.socket, 'battle:created');
  for (const u of [a, b]) u.socket.emit('match:accept', { matchId: fa.matchId }, () => {});
  return { a, b, matchId: (await created).matchId };
}

const view = async (matchId: string, u: TestUser) =>
  (
    await app.inject({ method: 'GET', url: `/api/matches/${matchId}`, headers: u.auth })
  ).json() as BattleView;
const submit = (matchId: string, u: TestUser, code: string) =>
  app.inject({
    method: 'POST',
    url: `/api/matches/${matchId}/submit`,
    headers: u.auth,
    payload: { language: 'python', code },
  });
const finished = (u: TestUser, matchId: string) =>
  next(u.socket, 'battle:finished', (p) => p.matchId === matchId);
const started = (u: TestUser, matchId: string) =>
  next(u.socket, 'battle:started', (p) => p.matchId === matchId);

describe('battle lifecycle', () => {
  it('queue → ready check → PENDING (problem hidden) → ACTIVE → first ACCEPTED wins', async () => {
    const { a, b, matchId } = await matchUp();
    const pendingView = await view(matchId, a);
    expect(pendingView).toMatchObject({
      status: 'PENDING',
      problem: null,
      totalTests: null,
      result: null,
    });
    expect(pendingView.players.map((p) => p.userId)).toEqual([a.id, b.id]); // viewer first
    expect(await submit(matchId, a, 'AC').then((r) => r.statusCode)).toBe(409); // not started yet

    await started(a, matchId);
    const live = await view(matchId, b);
    expect(live.status).toBe('ACTIVE');
    expect(live.problem?.slug).toBe('sum-of-array');
    expect(live.totalTests).toBe(9);

    const progress = next(
      b.socket,
      'battle:progress',
      (p) => p.player.userId === a.id && p.player.solved,
    );
    const judged = next(a.socket, 'submission:judged');
    const done = Promise.all([finished(a, matchId), finished(b, matchId)]);
    expect((await submit(matchId, a, 'AC')).statusCode).toBe(202);
    await judged;
    const [ra, rb] = await done;
    expect(ra.result).toEqual({ status: 'FINISHED', winnerId: a.id, endReason: 'SOLVED' });
    expect(rb.result).toEqual(ra.result);

    // The opponent only ever sees progress, never code.
    const seen: PlayerProgress = (await progress).player;
    expect(Object.keys(seen).sort()).toEqual(
      [
        'attempts',
        'bestPassed',
        'connected',
        'graceEndsAt',
        'pending',
        'rating',
        'solved',
        'userId',
        'username',
      ].sort(),
    );
    expect(JSON.stringify(await view(matchId, b))).not.toContain('"code"');

    // Players are released and can queue again.
    const ack = await new Promise<{ ok: boolean }>((r) => a.socket.emit('queue:join', r));
    expect(ack.ok).toBe(true);
    a.socket.emit('queue:leave', () => {});
  });

  it('hides matches from non-participants and rate limits submits to one per cooldown', async () => {
    const { a, matchId } = await matchUp();
    const outsider = await user();
    expect(
      (await app.inject({ method: 'GET', url: `/api/matches/${matchId}`, headers: outsider.auth }))
        .statusCode,
    ).toBe(404);
    expect((await submit(matchId, outsider, 'AC')).statusCode).toBe(404);

    await started(a, matchId);
    expect((await submit(matchId, a, 'PASS:1')).statusCode).toBe(202);
    const limited = await submit(matchId, a, 'PASS:2');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().retryAfterMs).toBeGreaterThan(0);
    await sleep(320);
    expect((await submit(matchId, a, 'PASS:2')).statusCode).toBe(202);
    await finished(a, matchId);
  });

  it('an earlier submission still being judged beats a later ACCEPTED judged first', async () => {
    const { a, b, matchId } = await matchUp();
    await started(a, matchId);
    const done = finished(a, matchId);
    await submit(matchId, a, 'SLOW:500;AC'); // submitted first, verdict arrives last
    await sleep(50);
    await submit(matchId, b, 'AC');
    expect((await done).result.winnerId).toBe(a.id);
  });
});

describe('time-out', () => {
  it('most tests passed wins when time runs out', async () => {
    const { a, b, matchId } = await matchUp();
    await started(a, matchId);
    const done = finished(b, matchId);
    await submit(matchId, a, 'PASS:3');
    await submit(matchId, b, 'PASS:5');
    const { result } = await done;
    expect(result).toEqual({ status: 'FINISHED', winnerId: b.id, endReason: 'TIMEOUT' });
    expect((await view(matchId, a)).players.find((p) => p.userId === b.id)?.bestPassed).toBe(5);
  });

  it('nobody scoring is a draw', async () => {
    const { a, matchId } = await matchUp();
    const { result } = await finished(a, matchId);
    expect(result).toEqual({ status: 'FINISHED', winnerId: null, endReason: 'TIMEOUT' });
  });

  it('submissions after endsAt are refused', async () => {
    const { a, matchId } = await matchUp();
    await finished(a, matchId);
    expect((await submit(matchId, a, 'AC')).statusCode).toBe(409);
  });
});

describe('disconnects', () => {
  it('forfeits a player who stays away past the grace period', async () => {
    const { a, b, matchId } = await matchUp();
    await started(a, matchId);
    const away = next(
      a.socket,
      'battle:progress',
      (p) => p.player.userId === b.id && !p.player.connected,
    );
    const done = finished(a, matchId);
    b.socket.disconnect();
    expect((await away).player.graceEndsAt).toBeGreaterThan(Date.now());
    expect((await done).result).toEqual({
      status: 'FINISHED',
      winnerId: a.id,
      endReason: 'FORFEIT',
    });
  });

  it('reconnecting within the grace period cancels the forfeit and resyncs the battle', async () => {
    const { a, b, matchId } = await matchUp();
    await started(a, matchId);
    b.socket.disconnect();
    await sleep(150);
    const token = signAccessToken({ sub: b.id, username: b.username });
    const s = connect(url, {
      transports: ['websocket'],
      auth: { token },
      forceNew: true,
      reconnection: false,
    });
    sockets.push(s);
    const resynced = await next(s, 'battle:created');
    expect(resynced.matchId).toBe(matchId);
    await sleep(500); // past the original grace deadline
    expect((await view(matchId, a)).status).toBe('ACTIVE');
    expect((await view(matchId, a)).players.find((p) => p.userId === b.id)?.connected).toBe(true);
    await finished(a, matchId); // ends normally on time-out
  });

  it('a stale "away" racing a reconnect never forfeits a connected player (reload race)', async () => {
    const { a, b, matchId } = await matchUp();
    await started(a, matchId);
    // Force the bad ordering a page reload can produce: the old socket's disconnect handler marks the
    // player away *after* the new socket is already connected.
    await rt.battle.markAway(b.id);
    await sleep(600); // past the grace period
    const v = await view(matchId, a);
    expect(v.status).toBe('ACTIVE');
    expect(v.players.find((p) => p.userId === b.id)?.connected).toBe(true);
    await finished(a, matchId);
  });

  it('both players gone → ABORTED', async () => {
    const { a, b, matchId } = await matchUp();
    await started(a, matchId);
    a.socket.disconnect();
    b.socket.disconnect();
    // Views are HTTP-only, so a disconnected player can still poll.
    for (let i = 0; i < 30 && (await view(matchId, a)).status !== 'ABORTED'; i++) await sleep(50);
    const m = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(m).toMatchObject({ status: 'ABORTED', winnerId: null, endReason: 'ABANDONED' });
  });
});

describe('server-authoritative timers', () => {
  it('the end timer survives an API node restart (BullMQ delayed job)', async () => {
    const { matchId } = await matchUp();
    expect(await (await battleQueue.getJob(`end_${matchId}_0`))?.isDelayed()).toBe(true);
    // Kill the node that created the match and bring up a fresh one with no in-memory state.
    await app.close();
    await start({ ...BATTLE, graceMs: 60_000 });
    for (let i = 0; i < 60; i++) {
      const m = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
      if (m.status === 'FINISHED') break;
      await sleep(100);
    }
    expect(await prisma.match.findUniqueOrThrow({ where: { id: matchId } })).toMatchObject({
      status: 'FINISHED',
      endReason: 'TIMEOUT',
    });
  });
});

describe('problem pick', () => {
  it('avoids problems either player has seen, falling back to nearer difficulties', async () => {
    const mk = (slug: string, difficulty: 'EASY' | 'MEDIUM' | 'HARD') =>
      prisma.problem.create({
        data: { slug, title: slug, difficulty, statement: '', starterCode: STARTER_CODE },
      });
    const [e2, m1, h1] = [
      await mk('easy-2', 'EASY'),
      await mk('medium-1', 'MEDIUM'),
      await mk('hard-1', 'HARD'),
    ];
    const [p, q] = [await user(), await user()];
    const easy1 = await prisma.problem.findUniqueOrThrow({ where: { slug: 'sum-of-array' } });
    await prisma.seenProblem.createMany({ data: [{ userId: p.id, problemId: easy1.id }] });
    expect((await pickProblem([p.id, q.id], 'EASY')).id).toBe(e2.id);
    await prisma.seenProblem.create({ data: { userId: q.id, problemId: e2.id } });
    expect((await pickProblem([p.id, q.id], 'EASY')).id).toBe(m1.id); // no unseen Easy left → Medium
    await prisma.seenProblem.create({ data: { userId: p.id, problemId: m1.id } });
    expect((await pickProblem([p.id, q.id], 'EASY')).id).toBe(h1.id);
    await prisma.problem.deleteMany({ where: { slug: { in: ['easy-2', 'medium-1', 'hard-1'] } } });
  });
});
