import type {
  BattleView,
  ClientToServerEvents,
  LeaderboardPage,
  MatchMode,
  PointsLeaderboardPage,
  ProfileView,
  ServerToClientEvents,
} from '@thegrave/shared';
import type { Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { seedBots } from '../src/seed/bots.js';
import { problems } from '../src/seed/problems.js';
import { projectData, projects } from '../src/seed/projects.js';
import { workspaceQueue } from '../src/workspace/queue.js';
import { resetState } from './helpers.js';

// Practice bots play real battles: they appear after a short wait, submit scripted attempts, and follow the
// normal win rules. Only the human's rating moves, and bots never show up on a board or in a search.
type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const BATTLE: Partial<BattleOptions> = {
  countdownMs: 500,
  durationMs: { EASY: 4_000, MEDIUM: 4_000, HARD: 4_000 },
  graceMs: 400,
  submitCooldownMs: 300,
  endGraceMs: 2000,
  endRecheckMs: 100,
};
const LONG: Partial<BattleOptions> = {
  ...BATTLE,
  durationMs: { EASY: 9_000, MEDIUM: 9_000, HARD: 9_000 },
};

const fakeExecutor: Executor = {
  async run(_lang, code, tests) {
    const n = code.startsWith('AC') ? tests.length : 0;
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
let seq = 0;

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
  await seedBots();
  app = await buildApp();
  rt = attachRealtime(app, {
    matchmaker: { tickMs: 100, botAfterMs: 0, botJitterMs: 0 },
    battle: BATTLE,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  judge = createJudgeWorker(fakeExecutor, { concurrency: 4 });
});

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await judge.close();
  await app.close();
  await Promise.all([submissionsQueue.close(), battleQueue.close(), workspaceQueue.close()]);
  await Promise.all([prisma.$disconnect(), redis.quit()]);
});

interface Human {
  id: string;
  username: string;
  auth: { authorization: string };
  socket: Client;
}

async function human(rating = 1500): Promise<Human> {
  const username = `lonely${seq++}`;
  const u = await prisma.user.create({
    data: { username, email: `${username}@x.io`, passwordHash: 'x', rating, ratedGames: 20 },
  });
  const token = signAccessToken({ sub: u.id, username });
  const socket: Client = connect(url, {
    transports: ['websocket'],
    auth: { token },
    forceNew: true,
    reconnection: false,
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return { id: u.id, username, auth: { authorization: `Bearer ${token}` }, socket };
}

function next<E extends keyof ServerToClientEvents>(
  s: Client,
  event: E,
  match: (...args: Parameters<ServerToClientEvents[E]>) => boolean = () => true,
  timeoutMs = 8000,
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

/** A lone player queues, is offered a bot, accepts, and the battle is created: exactly the client's path. */
async function playBot(h: Human, mode: MatchMode = 'DSA') {
  const found = next(h.socket, 'match:found');
  h.socket.emit('queue:join', { mode }, () => {});
  const f = await found;
  expect(f.opponent.bot).toBe(true);
  const created = next(h.socket, 'battle:created');
  h.socket.emit('match:accept', { matchId: f.matchId }, () => {});
  return { bot: f.opponent, matchId: (await created).matchId };
}

const view = async (matchId: string, u: Human) =>
  (
    await app.inject({ method: 'GET', url: `/api/matches/${matchId}`, headers: u.auth })
  ).json() as BattleView;
const finished = (u: Human, matchId: string) =>
  next(u.socket, 'battle:finished', (p) => p.matchId === matchId, 12_000);
const started = (u: Human, matchId: string) =>
  next(u.socket, 'battle:started', (p) => p.matchId === matchId);
const post = (matchId: string, u: Human, path: string, payload?: object) =>
  app.inject({ method: 'POST', url: `/api/matches/${matchId}/${path}`, headers: u.auth, payload });

describe('a lone player against a practice bot', () => {
  it('a bot that solves it wins; only the human rating changes', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01); // the bot solves, after two wrong attempts
    const h = await human();
    const { bot, matchId } = await playBot(h);
    const { result } = await finished(h, matchId);

    expect(result).toMatchObject({ status: 'FINISHED', winnerId: bot.id, endReason: 'SOLVED' });
    expect(result.ratingChanges).toHaveLength(1); // the bot's rating is a fixed yardstick
    expect(result.ratingChanges[0]).toMatchObject({ userId: h.id });
    expect(result.ratingChanges[0]!.delta).toBeLessThan(0);

    const v = await view(matchId, h);
    const botView = v.players.find((p) => p.userId === bot.id)!;
    expect(botView).toMatchObject({ bot: true, solved: true, connected: true });
    expect(botView.attempts).toBeGreaterThanOrEqual(3); // wrong tries first, then the solve
    expect(v.players.find((p) => p.userId === h.id)!.bot).toBeUndefined();

    const botRow = await prisma.user.findUniqueOrThrow({ where: { id: bot.id } });
    expect(botRow).toMatchObject({ rating: bot.rating, ratedGames: 0, ratingDev: 40, isBot: true });
    expect(await prisma.ratingHistory.count({ where: { userId: bot.id } })).toBe(0);
    const me = await prisma.user.findUniqueOrThrow({ where: { id: h.id } });
    expect(me.rating).toBeLessThan(1500);
    expect(me.ratedGames).toBe(21);
    // both players are released, so the human can queue again straight away
    expect(await rt.matchmaker.describe(h.id)).toEqual({ state: 'idle' });
    expect(await rt.matchmaker.describe(bot.id)).toEqual({ state: 'idle' });
  });

  it('the human wins by solving it first, and gains rating against the bot', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // the bot never cracks it
    const h = await human();
    const { bot, matchId } = await playBot(h);
    await started(h, matchId);
    expect((await post(matchId, h, 'submit', { language: 'python', code: 'AC' })).statusCode).toBe(
      202,
    );
    const { result } = await finished(h, matchId);

    expect(result).toMatchObject({ winnerId: h.id, endReason: 'SOLVED' });
    expect(result.ratingChanges).toHaveLength(1);
    expect(result.ratingChanges[0]!.delta).toBeGreaterThan(0);
    const botRow = await prisma.user.findUniqueOrThrow({ where: { id: bot.id } });
    expect(botRow.rating).toBe(bot.rating);
  });

  it('quitting hands the bot the win without touching the bot rating', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const h = await human();
    const { bot, matchId } = await playBot(h);
    const done = finished(h, matchId);
    expect((await post(matchId, h, 'resign')).statusCode).toBe(200);
    const { result } = await done;
    expect(result).toMatchObject({ winnerId: bot.id, endReason: 'RESIGNED' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: bot.id } })).rating).toBe(
      bot.rating,
    );
  });

  it('a bot turns down a draw offer after a moment', async () => {
    // a longer battle, and a bot that never solves, so the offer is answered while it is still running
    await app.close();
    app = await buildApp();
    rt = attachRealtime(app, {
      matchmaker: { tickMs: 100, botAfterMs: 0, botJitterMs: 0 },
      battle: LONG,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

    vi.spyOn(Math, 'random').mockReturnValue(0.99); // the bot never solves; it answers after ~4.5 s
    const h = await human();
    const { bot, matchId } = await playBot(h);
    await started(h, matchId);
    const declined = next(h.socket, 'battle:draw', (p) => p.declinedBy === bot.id, 8000);
    expect((await post(matchId, h, 'draw', { action: 'offer' })).statusCode).toBe(200);
    await declined;
    expect((await view(matchId, h)).drawOfferedBy).toBeNull();
    await post(matchId, h, 'resign');
  });
});

describe('a bot in a programming battle', () => {
  it('submits full-suite runs like a player and can win', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const h = await human();
    const { bot, matchId } = await playBot(h, 'PROGRAMMING');
    const { result } = await finished(h, matchId);
    expect(result).toMatchObject({ winnerId: bot.id, endReason: 'SOLVED' });
    expect(result.ratingChanges).toHaveLength(1);

    const runs = await prisma.projectRun.findMany({ where: { matchId, userId: bot.id } });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    const last = runs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).at(-1)!;
    expect(last).toMatchObject({ kind: 'SUBMIT', status: 'DONE' });
    expect(last.passed).toBe(last.total);
    expect((await view(matchId, h)).players.find((p) => p.userId === bot.id)).toMatchObject({
      bot: true,
      solved: true,
    });
  });
});

describe('bots stay out of the way', () => {
  it('never appear on a leaderboard or in search, cannot log in, and are labelled on their profile', async () => {
    const viewer = await human();
    const botRow = await prisma.user.findFirstOrThrow({
      where: { isBot: true },
      orderBy: { rating: 'asc' },
    });
    // a bot with a solved problem and a rated game would otherwise rank
    await prisma.user.update({ where: { id: botRow.id }, data: { ratedGames: 30, ratingDev: 40 } });
    await rt.leaderboard.rebuild();

    const rating = (
      await app.inject({ method: 'GET', url: '/api/leaderboard', headers: viewer.auth })
    ).json() as LeaderboardPage;
    expect(rating.entries.map((e) => e.userId)).not.toContain(botRow.id);

    const points = (
      await app.inject({ method: 'GET', url: '/api/leaderboard/problems', headers: viewer.auth })
    ).json() as PointsLeaderboardPage;
    expect(points.entries.map((e) => e.userId)).not.toContain(botRow.id);

    const hits = (
      await app.inject({
        method: 'GET',
        url: `/api/search/users?q=${botRow.username.slice(0, 4)}`,
        headers: viewer.auth,
      })
    ).json() as { username: string }[];
    expect(hits.map((x) => x.username)).not.toContain(botRow.username);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: botRow.email, password: 'anything-at-all' },
    });
    expect(login.statusCode).toBe(401);

    const profile = (
      await app.inject({
        method: 'GET',
        url: `/api/users/${botRow.username}`,
        headers: viewer.auth,
      })
    ).json() as ProfileView;
    expect(profile).toMatchObject({ username: botRow.username, bot: true });
  });
});
