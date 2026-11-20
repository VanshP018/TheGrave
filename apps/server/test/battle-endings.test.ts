import type { BattleView, ClientToServerEvents, ServerToClientEvents } from '@thegrave/shared';
import type { Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
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
  durationMs: { EASY: 10_000, MEDIUM: 10_000, HARD: 10_000 },
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
    // The real judge appends the hidden driver to a bare function, so match on the script's prefix.
    const n = c.startsWith('AC')
      ? tests.length
      : c.startsWith('PASS:')
        ? Number.parseInt(c.slice(5), 10)
        : 0;
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
const finished = (u: TestUser, matchId: string) =>
  next(u.socket, 'battle:finished', (p) => p.matchId === matchId);
const started = (u: TestUser, matchId: string) =>
  next(u.socket, 'battle:started', (p) => p.matchId === matchId);

const post = (matchId: string, u: TestUser, path: string, payload?: object) =>
  app.inject({ method: 'POST', url: `/api/matches/${matchId}/${path}`, headers: u.auth, payload });

describe('quit and draw', () => {
  it('quitting hands the win to the opponent, rated, and frees both players', async () => {
    const { a, b, matchId } = await matchUp();
    const done = finished(b, matchId);
    expect((await post(matchId, a, 'resign')).statusCode).toBe(200); // allowed during the countdown
    const { result } = await done;
    expect(result).toMatchObject({ status: 'FINISHED', winnerId: b.id, endReason: 'RESIGNED' });
    expect(result.ratingChanges).toHaveLength(2);
    expect((await post(matchId, a, 'resign')).statusCode).toBe(409);
    expect(await rt.matchmaker.describe(a.id)).toEqual({ state: 'idle' });
  });

  it('draw offers: one at a time, opponent-only answers, cooldown after a decline, accept ends it', async () => {
    const { a, b, matchId } = await matchUp();
    expect((await post(matchId, a, 'draw', { action: 'offer' })).statusCode).toBe(409); // not started
    await started(a, matchId);

    const offered = next(b.socket, 'battle:draw', (p) => p.offeredBy === a.id);
    expect((await post(matchId, a, 'draw', { action: 'offer' })).statusCode).toBe(200);
    await offered;
    expect((await view(matchId, b)).drawOfferedBy).toBe(a.id);
    expect((await post(matchId, b, 'draw', { action: 'offer' })).statusCode).toBe(409); // one open offer
    expect((await post(matchId, a, 'draw', { action: 'accept' })).statusCode).toBe(409); // not your own

    const declined = next(a.socket, 'battle:draw', (p) => p.declinedBy === b.id);
    expect((await post(matchId, b, 'draw', { action: 'decline' })).statusCode).toBe(200);
    await declined;
    expect((await post(matchId, a, 'draw', { action: 'offer' })).statusCode).toBe(429); // cooldown

    // The other player can still offer; withdrawing and re-offering works; accepting ends the match.
    expect((await post(matchId, b, 'draw', { action: 'offer' })).statusCode).toBe(200);
    expect((await post(matchId, b, 'draw', { action: 'withdraw' })).statusCode).toBe(200);
    expect((await view(matchId, a)).drawOfferedBy).toBeNull();
    expect((await post(matchId, b, 'draw', { action: 'offer' })).statusCode).toBe(200);
    const done = Promise.all([finished(a, matchId), finished(b, matchId)]);
    expect((await post(matchId, a, 'draw', { action: 'accept' })).statusCode).toBe(200);
    const [{ result }] = await done;
    expect(result).toMatchObject({ status: 'FINISHED', winnerId: null, endReason: 'AGREED' });
    expect(result.ratingChanges).toHaveLength(2); // a rated draw, like a time-out draw
    expect((await view(matchId, a)).drawOfferedBy).toBeNull();
  });
});
