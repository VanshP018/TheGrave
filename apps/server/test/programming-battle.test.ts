import {
  type Ack,
  type RoomView,
  type BattleView,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@thegrave/shared';
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
import { projectData, projects } from '../src/seed/projects.js';
import type { WorkspaceRunner } from '../src/workspace/executor.js';
import { workspaceQueue } from '../src/workspace/queue.js';
import { createWorkspaceWorker } from '../src/workspace/worker.js';

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

/** Scripted sandbox: a file `ANSWER` holding `AC` passes the whole suite, `PASS:n` passes n tests. */
const fakeWorkspace: WorkspaceRunner = {
  async run(_lang, files, req) {
    if (req.mode === 'exec')
      return { exitCode: 0, output: '', timedOut: false, timeMs: 1, results: [] };
    const total =
      Object.entries(files)
        .filter(([path]) => path.startsWith(`${req.testDir}/`))
        .map(([, src]) => src)
        .join('')
        .match(/^\s+def test_|^test\(/gm)?.length ?? 0;
    const a = files.ANSWER ?? '';
    const n = a === 'AC' ? total : a.startsWith('PASS:') ? Number(a.slice(5)) : 0;
    return {
      exitCode: 0,
      output: '',
      timedOut: false,
      timeMs: 1,
      results: Array.from({ length: total }, (_, i) => ({
        name: `t${i}`,
        status: i < n ? ('pass' as const) : ('fail' as const),
        message: '',
      })),
    };
  },
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
let workspace: Worker;
let url: string;
const sockets: Client[] = [];
let userSeq = 0;
const tokens = new Map<string, string>();

async function start(opts: Partial<BattleOptions> = BATTLE) {
  app = await buildApp();
  rt = attachRealtime(app, { matchmaker: { tickMs: 100 }, battle: opts, rooms: { graceMs: 300 } });
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
  for (const p of projects)
    await prisma.project.create({ data: { slug: p.slug, ...projectData(p) } });
  await start();
  workspace = createWorkspaceWorker(fakeWorkspace, { concurrency: 4 });
  judge = createJudgeWorker(fakeExecutor, { concurrency: 4 });
});

afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await judge.close();
  await workspace.close();
  await workspaceQueue.close();
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
  tokens.set(u.id, token);
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

/** Emits a client event and resolves with its ack. */
function call<T = Ack>(s: Client, event: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve) => (s.emit as (...a: unknown[]) => void)(event, ...args, resolve));
}

const view = async (matchId: string, u: TestUser) =>
  (
    await app.inject({ method: 'GET', url: `/api/matches/${matchId}`, headers: u.auth })
  ).json() as BattleView;
const submitFiles = (matchId: string, u: TestUser, files: Record<string, string>) =>
  app.inject({
    method: 'POST',
    url: `/api/matches/${matchId}/submit`,
    headers: u.auth,
    payload: { files },
  });

describe('programming battles', () => {
  it('has its own queue: never pairs across modes, one queue at a time', async () => {
    const [d, p] = [await user(), await user()];
    expect((await call(d.socket, 'queue:join')).ok).toBe(true); // bare ack = DSA
    expect((await call(p.socket, 'queue:join', { mode: 'PROGRAMMING' })).ok).toBe(true);
    expect(await call(d.socket, 'queue:join', { mode: 'PROGRAMMING' })).toMatchObject({
      ok: false,
      code: 'IN_QUEUE',
    });
    await sleep(400); // several ticks: a DSA and a programming player must not be paired
    expect(await rt.queues.DSA.describe(d.id)).toMatchObject({ state: 'queued' });
    expect(await rt.queues.PROGRAMMING.describe(p.id)).toMatchObject({ state: 'queued' });
    expect(await rt.queues.DSA.describe(p.id)).toEqual({ state: 'idle' });
    for (const u of [d, p]) expect((await call(u.socket, 'queue:leave')).ok).toBe(true);
  });

  it('ranked: a codebase hidden until start, files graded by hidden tests, rated', async () => {
    const [a, b] = [await user(), await user()];
    const found = Promise.all([next(a.socket, 'match:found'), next(b.socket, 'match:found')]);
    for (const u of [a, b]) u.socket.emit('queue:join', { mode: 'PROGRAMMING' }, () => {});
    const [fa] = await found;
    expect(fa.mode).toBe('PROGRAMMING');
    const created = next(a.socket, 'battle:created');
    for (const u of [a, b]) u.socket.emit('match:accept', { matchId: fa.matchId }, () => {});
    const { matchId } = await created;

    const pending = await view(matchId, a);
    expect(pending).toMatchObject({
      mode: 'PROGRAMMING',
      problem: null,
      project: null,
      rated: true,
    });

    await next(a.socket, 'battle:started', (x) => x.matchId === matchId);
    const live = await view(matchId, b);
    expect(live.project?.slug).toBe('shopping-cart'); // new players → Easy
    expect(live.totalTests).toBe(7);
    expect(JSON.stringify(live)).not.toContain('test_hidden');

    // The practice endpoint can't be used to peek at the hidden suite mid-battle; terminal and visible tests can.
    const practice = (kind: string) =>
      app.inject({
        method: 'POST',
        url: '/api/projects/shopping-cart/runs',
        headers: a.auth,
        payload: {
          kind,
          files: live.project!.files,
          command: kind === 'COMMAND' ? 'ls' : undefined,
        },
      });
    expect((await practice('SUBMIT')).statusCode).toBe(409);
    expect((await practice('TEST')).statusCode).toBe(202);

    // DSA-style bodies are rejected; files are graded.
    const wrongBody = await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/submit`,
      headers: a.auth,
      payload: { language: 'python', code: 'x' },
    });
    expect(wrongBody.statusCode).toBe(409);
    expect(
      (await submitFiles(matchId, b, { ...live.project!.files, ANSWER: 'PASS:3' })).statusCode,
    ).toBe(202);
    await next(
      a.socket,
      'battle:progress',
      (x) => x.player.userId === b.id && x.player.bestPassed === 3,
    );
    await sleep(350); // the submit cooldown
    const done = Promise.all([
      next(a.socket, 'battle:finished', (x) => x.matchId === matchId),
      next(b.socket, 'battle:finished', (x) => x.matchId === matchId),
    ]);
    expect(
      (await submitFiles(matchId, a, { ...live.project!.files, ANSWER: 'AC' })).statusCode,
    ).toBe(202);
    const [ra] = await done;
    expect(ra.result).toMatchObject({ status: 'FINISHED', winnerId: a.id, endReason: 'SOLVED' });
    expect(ra.result.ratingChanges!.find((c) => c.userId === a.id)!.delta).toBeGreaterThan(0);

    const after = await view(matchId, a);
    expect(after.mySubmissions).toEqual([
      expect.objectContaining({
        verdict: 'ACCEPTED',
        testsPassed: 7,
        testsTotal: 7,
        language: 'python',
      }),
    ]);
  });

  it('a private room can start an unrated programming battle at the chosen difficulty', async () => {
    const [host, guest] = [await user(), await user()];
    const created = await call<Ack<{ room: RoomView }>>(host.socket, 'room:create', {
      mode: 'PROGRAMMING',
    });
    if (!created.ok) throw new Error(created.message);
    expect(created.room.mode).toBe('PROGRAMMING');
    await call(guest.socket, 'room:join', { code: created.room.code });
    await call(host.socket, 'room:update', { difficulty: 'HARD' });
    await call(guest.socket, 'room:update', { ready: true });
    // Switching mode un-readies the guest; switch back and ready again.
    const unready = next(host.socket, 'room:updated', (r) => r.mode === 'DSA' && !r.guestReady);
    await call(host.socket, 'room:update', { mode: 'DSA' });
    await unready;
    await call(host.socket, 'room:update', { mode: 'PROGRAMMING' });
    await call(guest.socket, 'room:update', { ready: true });

    const battle = next(guest.socket, 'battle:created');
    expect((await call(host.socket, 'room:start')).ok).toBe(true);
    const { matchId } = await battle;
    await next(host.socket, 'battle:started', (x) => x.matchId === matchId);
    const v = await view(matchId, host);
    expect(v).toMatchObject({ mode: 'PROGRAMMING', rated: false });
    expect(['bank-ledger', 'order-service']).toContain(v.project?.slug); // the Hard codebases
  });
});
