import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
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

async function hostWithGuest() {
  const [host, guest] = [await user(), await user()];
  const created = await call<Ack<{ room: RoomView }>>(host.socket, 'room:create');
  if (!created.ok) throw new Error(created.message);
  const code = created.room.code;
  const updated = next(host.socket, 'room:updated', (r) => r.guest?.id === guest.id);
  const joined = await call<Ack<{ room: RoomView }>>(guest.socket, 'room:join', {
    code: ` ${code.toLowerCase().slice(0, 3)}-${code.toLowerCase().slice(3)} `,
  });
  expect(joined.ok).toBe(true);
  await updated;
  return { host, guest, code };
}

describe('private rooms', () => {
  it('creates a shareable code and lets exactly one friend in', async () => {
    const { host, guest, code } = await hostWithGuest();
    expect(code).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`));

    const third = await user();
    expect(await call(third.socket, 'room:join', { code })).toMatchObject({
      ok: false,
      code: 'ROOM_FULL',
    });
    expect(await call(third.socket, 'room:join', { code: 'ZZZZZZ' })).toMatchObject({
      ok: false,
      code: 'ROOM_NOT_FOUND',
    });
    // A room member can't queue for ranked, and nobody can be in two rooms.
    expect(await call(guest.socket, 'queue:join')).toMatchObject({ ok: false, code: 'IN_ROOM' });
    expect(await call(host.socket, 'room:create')).toMatchObject({ ok: false, code: 'IN_ROOM' });
    // And a queued player can't open a room.
    expect((await call(third.socket, 'queue:join')).ok).toBe(true);
    expect(await call(third.socket, 'room:create')).toMatchObject({
      ok: false,
      code: 'IN_QUEUE',
    });
    await call(third.socket, 'queue:leave');
    await call(host.socket, 'room:leave');
  });

  it('host picks difficulty, guest readies, host starts an unrated battle', async () => {
    const { host, guest } = await hostWithGuest();
    expect(await call(guest.socket, 'room:update', { difficulty: 'HARD' })).toMatchObject({
      ok: false,
      code: 'NOT_ALLOWED',
    });
    expect(await call(host.socket, 'room:start')).toMatchObject({ ok: false, code: 'NOT_ALLOWED' }); // not ready
    expect(await call(guest.socket, 'room:start')).toMatchObject({
      ok: false,
      code: 'NOT_ALLOWED',
    });

    const easy = next(guest.socket, 'room:updated', (r) => r.difficulty === 'EASY');
    expect((await call(host.socket, 'room:update', { difficulty: 'EASY' })).ok).toBe(true);
    await easy;
    const ready = next(host.socket, 'room:updated', (r) => r.guestReady);
    expect((await call(guest.socket, 'room:update', { ready: true })).ok).toBe(true);
    await ready;

    const created = Promise.all([
      next(host.socket, 'battle:created'),
      next(guest.socket, 'battle:created'),
    ]);
    expect((await call(host.socket, 'room:start')).ok).toBe(true);
    const [{ matchId }, g] = await created;
    expect(g.matchId).toBe(matchId);
    const v = await view(matchId, guest);
    expect(v.rated).toBe(false);

    await next(host.socket, 'battle:started', (p) => p.matchId === matchId);
    const done = next(guest.socket, 'battle:finished', (p) => p.matchId === matchId);
    await app.inject({
      method: 'POST',
      url: `/api/matches/${matchId}/submit`,
      headers: host.auth,
      payload: { language: 'python', code: 'AC' },
    });
    const { result } = await done;
    expect(result).toMatchObject({ status: 'FINISHED', winnerId: host.id, ratingChanges: [] });
    const after = await prisma.user.findMany({ where: { id: { in: [host.id, guest.id] } } });
    expect(after.map((u) => [u.rating, u.ratedGames])).toEqual([
      [1500, 0],
      [1500, 0],
    ]);
    // Released: both can queue again.
    expect((await call(guest.socket, 'queue:join')).ok).toBe(true);
    await call(guest.socket, 'queue:leave');
  });

  it('closes for the guest when the host leaves, and the host can kick', async () => {
    const a = await hostWithGuest();
    const closed = next(a.guest.socket, 'room:closed');
    await call(a.host.socket, 'room:leave');
    expect(await closed).toMatchObject({ code: a.code, reason: 'host-left' });
    expect((await call(a.guest.socket, 'queue:join')).ok).toBe(true); // state was cleared
    await call(a.guest.socket, 'queue:leave');

    const b = await hostWithGuest();
    const kicked = next(b.guest.socket, 'room:closed');
    const empty = next(b.host.socket, 'room:updated', (r) => r.guest === null);
    expect((await call(b.host.socket, 'room:update', { kick: true })).ok).toBe(true);
    expect(await kicked).toMatchObject({ reason: 'kicked' });
    await empty;
    await call(b.host.socket, 'room:leave');
  });

  it('keeps a member through a quick reload, drops them after the grace period', async () => {
    const { host, guest } = await hostWithGuest();
    guest.socket.disconnect();
    const back = await openSocket(tokens.get(guest.id)!);
    const resynced = await next(back, 'room:updated');
    expect(resynced.guest?.id).toBe(guest.id);
    await sleep(500);
    expect((await rt.rooms.current(host.id))?.guest?.id).toBe(guest.id);

    const gone = next(host.socket, 'room:updated', (r) => r.guest === null, 3000);
    back.disconnect();
    await gone;
    await call(host.socket, 'room:leave');
  });
});
