import type { InterviewDetail, InterviewListResponse } from '@thegrave/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { TIER_PROFILES } from '../src/interviews/budget.js';
import { spendKey } from '../src/interviews/capacity.js';
import { FakeInterviewLlm } from '../src/interviews/fake-llm.js';
import { processInterview } from '../src/interviews/process.js';
import { interviewsQueue } from '../src/interviews/queue.js';
import { MemoryRepoSource } from '../src/interviews/source.js';
import { prisma } from '../src/lib/prisma.js';
import { redis } from '../src/lib/redis.js';
import { expressApi } from './fixtures/interview-repos.js';
import { closeAll, registerUser, resetState } from './helpers.js';

const budget = { ...TIER_PROFILES.developer, dailyLimit: 2, queueMax: 100 };
const repoUrl = 'https://github.com/Acme/Orders';

let app: FastifyInstance;
let alice: { authorization: string };
let bob: { authorization: string };

beforeAll(async () => {
  app = await buildApp({ interviewsEnabled: true, interviewBudget: budget });
  await app.ready();
});
afterAll(async () => {
  await interviewsQueue.close();
  await closeAll(app);
});
beforeEach(async () => {
  await resetState();
  alice = await registerUser(app, 'alice');
  bob = await registerUser(app, 'bob');
});

const post = (headers: object | undefined, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/interviews', headers, payload: payload as object });
const userId = async (name: string) =>
  (await prisma.user.findFirstOrThrow({ where: { username: name } })).id;
const list = async (h = alice) =>
  (
    await app.inject({ method: 'GET', url: '/api/interviews', headers: h })
  ).json<InterviewListResponse>();
const chargedRow = async (name: string, createdAt = new Date()) =>
  prisma.interviewAnalysis.create({
    data: {
      userId: await userId(name),
      repoOwner: 'x',
      repoName: 'y',
      status: 'DONE',
      stage: 'DONE',
      charged: true,
      createdAt,
      finishedAt: createdAt,
    },
  });

describe('auth', () => {
  it('requires a token on every route', async () => {
    for (const [method, url] of [
      ['GET', '/api/interviews'],
      ['POST', '/api/interviews'],
      ['GET', '/api/interviews/00000000-0000-7000-8000-000000000000'],
      ['DELETE', '/api/interviews/00000000-0000-7000-8000-000000000000'],
    ] as const)
      expect((await app.inject({ method, url })).statusCode, `${method} ${url}`).toBe(401);
  });
});

describe('POST /api/interviews', () => {
  it('queues an analysis: 202, a QUEUED row, and a BullMQ job whose id is the analysis id', async () => {
    const res = await post(alice, { repoUrl, level: 'SENIOR' });
    expect(res.statusCode).toBe(202);
    const { id, status } = res.json<{ id: string; status: string }>();
    expect(status).toBe('QUEUED');
    const row = await prisma.interviewAnalysis.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      userId: await userId('alice'),
      repoOwner: 'acme',
      repoName: 'orders',
      ref: null,
      requestedLevel: 'SENIOR',
      status: 'QUEUED',
      charged: false,
    });
    const job = await interviewsQueue.getJob(id);
    expect(job?.data).toEqual({ analysisId: id });
  });

  it('keeps a /tree/<ref> branch and defaults the level to AUTO', async () => {
    const res = await post(alice, { repoUrl: 'acme/orders/tree/feature/x' });
    expect(res.statusCode).toBe(202);
    const row = await prisma.interviewAnalysis.findUniqueOrThrow({
      where: { id: res.json().id },
    });
    expect(row.ref).toBe('feature/x');
    expect(row.requestedLevel).toBe('AUTO');
  });

  it.each([
    ['a non-GitHub host', { repoUrl: 'https://evil.com/acme/orders' }],
    ['a blob URL', { repoUrl: 'https://github.com/acme/orders/blob/main/a.ts' }],
    ['an empty url', { repoUrl: '' }],
    ['a missing url', {}],
    ['an unknown level', { repoUrl, level: 'GOD' }],
    ['an over-long url', { repoUrl: `acme/${'a'.repeat(400)}` }],
  ])('rejects %s with 400 and creates nothing', async (_n, body) => {
    const res = await post(alice, body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Bad Request');
    expect(await prisma.interviewAnalysis.count()).toBe(0);
  });

  it('409s with activeId while one is queued or running', async () => {
    const first = (await post(alice, { repoUrl })).json<{ id: string }>();
    const res = await post(alice, { repoUrl: 'acme/other' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      message: 'You already have an analysis running',
      activeId: first.id,
    });
    // Another user is unaffected.
    expect((await post(bob, { repoUrl })).statusCode).toBe(202);
    // Once it is no longer active a new one is accepted.
    await prisma.interviewAnalysis.update({ where: { id: first.id }, data: { status: 'FAILED' } });
    expect((await post(alice, { repoUrl })).statusCode).toBe(202);
  });

  it('429s with Retry-After once the daily limit of charged analyses is reached', async () => {
    const oldest = new Date(Date.now() - 3 * 3600_000);
    await chargedRow('alice', oldest);
    await chargedRow('alice');
    const res = await post(alice, { repoUrl });
    expect(res.statusCode).toBe(429);
    const body = res.json<{ message: string; retryAfterMs: number }>();
    expect(body.message).toBe('Daily limit reached');
    // The oldest charge leaves the rolling window in ~21 h.
    expect(body.retryAfterMs).toBeGreaterThan(20 * 3600_000);
    expect(body.retryAfterMs).toBeLessThanOrEqual(21 * 3600_000);
    expect(Number(res.headers['retry-after'])).toBe(Math.ceil(body.retryAfterMs / 1000));
    expect((await list()).quota).toMatchObject({ used: 2, limit: 2 });
    expect((await list()).quota.resetsAt).toBe(
      new Date(oldest.getTime() + 86_400_000).toISOString(),
    );
    // Other users and uncharged/old rows do not count.
    expect((await post(bob, { repoUrl })).statusCode).toBe(202);
  });

  it('does not count uncharged analyses or charges older than 24 h', async () => {
    await chargedRow('alice', new Date(Date.now() - 25 * 3600_000));
    await chargedRow('alice', new Date(Date.now() - 26 * 3600_000));
    await prisma.interviewAnalysis.create({
      data: { userId: await userId('alice'), repoOwner: 'x', repoName: 'y', status: 'FAILED' },
    });
    expect((await post(alice, { repoUrl })).statusCode).toBe(202);
  });

  it('503s when the global daily spend cap is reached', async () => {
    await redis.set(spendKey(), String(config.INTERVIEW_DAILY_BUDGET_USD * 1_000_000));
    const res = await post(alice, { repoUrl });
    expect(res.statusCode).toBe(503);
    expect(res.json().message).toBe('The AI has reached its limit for today');
    expect(res.json().retryAfterMs).toBeGreaterThan(0);
    expect(await prisma.interviewAnalysis.count()).toBe(0);
    expect((await list()).capacity.available).toBe(false);
  });

  it('503s with retryAfterMs while Groq is flagged exhausted for an interview model', async () => {
    await redis.set(
      `interviews:groq:exhausted:${config.INTERVIEW_TRIAGE_MODEL}`,
      String(Date.now() + 120_000),
      'PX',
      120_000,
    );
    const res = await post(alice, { repoUrl });
    expect(res.statusCode).toBe(503);
    expect(res.json().retryAfterMs).toBeGreaterThan(60_000);
    expect(res.headers['retry-after']).toBeDefined();
    const cap = (await list()).capacity;
    expect(cap.available).toBe(false);
    expect(cap.retryAt).not.toBeNull();
  });

  it('503s when the queue is full', async () => {
    const small = await buildApp({
      interviewsEnabled: true,
      interviewBudget: { ...budget, queueMax: 1 },
    });
    await small.ready();
    try {
      expect(
        (
          await small.inject({
            method: 'POST',
            url: '/api/interviews',
            headers: alice,
            payload: { repoUrl },
          })
        ).statusCode,
      ).toBe(202);
      const res = await small.inject({
        method: 'POST',
        url: '/api/interviews',
        headers: bob,
        payload: { repoUrl },
      });
      expect(res.statusCode).toBe(503);
      expect(res.headers['retry-after']).toBe('30');
    } finally {
      await small.close();
    }
  });

  it('503s when interviews are not configured, but the list still answers enabled: false', async () => {
    const off = await buildApp({ interviewsEnabled: false });
    await off.ready();
    try {
      const res = await off.inject({
        method: 'POST',
        url: '/api/interviews',
        headers: alice,
        payload: { repoUrl },
      });
      expect(res.statusCode).toBe(503);
      expect(await prisma.interviewAnalysis.count()).toBe(0);
      const l = await off.inject({ method: 'GET', url: '/api/interviews', headers: alice });
      expect(l.json().enabled).toBe(false);
    } finally {
      await off.close();
    }
  });

  it('is rate limited to 5 per minute per user', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post(alice, { repoUrl: '' })).statusCode);
    expect(codes.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(codes[5]).toBe(429);
    // Per user, not per IP.
    expect((await post(bob, { repoUrl })).statusCode).toBe(202);
  });

  it('keeps only the newest 50 analyses per user', async () => {
    const uid = await userId('alice');
    await prisma.interviewAnalysis.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        userId: uid,
        repoOwner: 'x',
        repoName: `r${i}`,
        status: 'FAILED' as const,
        createdAt: new Date(Date.now() - (60 - i) * 60_000),
      })),
    });
    expect((await post(alice, { repoUrl })).statusCode).toBe(202);
    expect(await prisma.interviewAnalysis.count({ where: { userId: uid } })).toBe(50);
    expect(await prisma.interviewAnalysis.count({ where: { repoName: 'r0' } })).toBe(0);
  });
});

describe('GET /api/interviews and /:id', () => {
  it('lists own analyses newest first with quota and capacity, hiding other users', async () => {
    const mine = (await post(alice, { repoUrl })).json<{ id: string }>();
    await post(bob, { repoUrl: 'bob/private-ish' });
    const l = await list();
    expect(l.enabled).toBe(true);
    expect(l.items.map((i) => i.id)).toEqual([mine.id]);
    expect(l.items[0]).toMatchObject({
      owner: 'acme',
      repo: 'orders',
      status: 'QUEUED',
      stage: 'QUEUED',
      errorCode: null,
      questionCount: 0,
      finishedAt: null,
    });
    expect(l.quota).toEqual({ used: 0, limit: 2, resetsAt: null });
    expect(l.capacity).toEqual({ available: true, retryAt: null });
  });

  it('shows progress while active and questions, profile and cache provenance once done', async () => {
    const { id } = (await post(alice, { repoUrl })).json<{ id: string }>();
    const queued = (
      await app.inject({ method: 'GET', url: `/api/interviews/${id}`, headers: alice })
    ).json<InterviewDetail>();
    expect(queued).toMatchObject({
      status: 'QUEUED',
      progress: null,
      profile: null,
      questions: [],
    });

    await prisma.interviewAnalysis.update({
      where: { id },
      data: {
        status: 'RUNNING',
        stage: 'WRITING',
        progress: { detail: 'Waiting for AI capacity', waitingUntil: '2030-01-01T00:00:00.000Z' },
      },
    });
    const running = (
      await app.inject({ method: 'GET', url: `/api/interviews/${id}`, headers: alice })
    ).json<InterviewDetail>();
    expect(running.progress).toEqual({
      detail: 'Waiting for AI capacity',
      waitingUntil: '2030-01-01T00:00:00.000Z',
    });

    // Run the real processor (fake LLM, in-memory repo) and read the result back through the API.
    await processInterview(id, {
      source: new MemoryRepoSource(expressApi),
      llm: new FakeInterviewLlm(TIER_PROFILES.developer),
      budget: TIER_PROFILES.developer,
    });
    const done = (
      await app.inject({ method: 'GET', url: `/api/interviews/${id}`, headers: alice })
    ).json<InterviewDetail>();
    expect(done.status).toBe('DONE');
    expect(done.progress).toBeNull();
    expect(done.questionCount).toBe(done.questions.length);
    expect(done.questions.length).toBeGreaterThanOrEqual(5);
    expect(done.questions.map((q) => q.position)).toEqual(done.questions.map((_, i) => i));
    expect(done.questions[0]!.evidence[0]).toMatchObject({ path: expect.any(String) });
    expect(done.profile).toMatchObject({ displayName: 'acme/orders' });
    expect(done.commitSha).toBe('a'.repeat(40));
  });

  it('exposes the error code of a failed analysis', async () => {
    const { id } = (await post(alice, { repoUrl })).json<{ id: string }>();
    await processInterview(id, {
      source: new MemoryRepoSource({ 'README.md': '# docs\n' }),
      llm: new FakeInterviewLlm(TIER_PROFILES.developer),
      budget: TIER_PROFILES.developer,
    });
    const d = (
      await app.inject({ method: 'GET', url: `/api/interviews/${id}`, headers: alice })
    ).json<InterviewDetail>();
    expect(d).toMatchObject({ status: 'FAILED', errorCode: 'NO_SOURCE_FILES' });
  });

  it("404s for another user's analysis and for a malformed id", async () => {
    const { id } = (await post(alice, { repoUrl })).json<{ id: string }>();
    expect(
      (await app.inject({ method: 'GET', url: `/api/interviews/${id}`, headers: bob })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/interviews/not-a-uuid', headers: alice }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/interviews/00000000-0000-7000-8000-000000000000',
          headers: alice,
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('DELETE /api/interviews/:id', () => {
  it('deletes the row and cascades its questions, then 404s', async () => {
    const { id } = (await post(alice, { repoUrl })).json<{ id: string }>();
    await processInterview(id, {
      source: new MemoryRepoSource(expressApi),
      llm: new FakeInterviewLlm(TIER_PROFILES.developer),
      budget: TIER_PROFILES.developer,
    });
    expect(await prisma.interviewQuestion.count({ where: { analysisId: id } })).toBeGreaterThan(0);
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/interviews/${id}`,
      headers: alice,
    });
    expect(del.statusCode).toBe(204);
    expect(await prisma.interviewAnalysis.count()).toBe(0);
    expect(await prisma.interviewQuestion.count()).toBe(0);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/interviews/${id}`, headers: alice }))
        .statusCode,
    ).toBe(404);
  });

  it("cannot delete another user's analysis", async () => {
    const { id } = (await post(alice, { repoUrl })).json<{ id: string }>();
    const res = await app.inject({ method: 'DELETE', url: `/api/interviews/${id}`, headers: bob });
    expect(res.statusCode).toBe(404);
    expect(await prisma.interviewAnalysis.count({ where: { id } })).toBe(1);
  });

  it('removes a waiting job and frees the active slot', async () => {
    const { id } = (await post(alice, { repoUrl })).json<{ id: string }>();
    expect(await interviewsQueue.getJob(id)).toBeDefined();
    await app.inject({ method: 'DELETE', url: `/api/interviews/${id}`, headers: alice });
    expect(await interviewsQueue.getJob(id)).toBeUndefined();
    expect((await post(alice, { repoUrl })).statusCode).toBe(202);
  });
});

describe('cache hit through the API', () => {
  it('a repeat request for the same repo, commit and level is served free and does not use quota', async () => {
    const run = (id: string) =>
      processInterview(id, {
        source: new MemoryRepoSource(expressApi),
        llm: new FakeInterviewLlm(TIER_PROFILES.developer),
        budget: TIER_PROFILES.developer,
      });
    const a = (await post(alice, { repoUrl })).json<{ id: string }>();
    await run(a.id);
    const b = (await post(bob, { repoUrl: 'ACME/orders' })).json<{ id: string }>();
    await run(b.id);
    const detail = (
      await app.inject({ method: 'GET', url: `/api/interviews/${b.id}`, headers: bob })
    ).json<InterviewDetail>();
    expect(detail.status).toBe('DONE');
    expect(detail.questions.length).toBeGreaterThanOrEqual(5);
    expect((await list(bob)).quota.used).toBe(0);
    expect((await list(alice)).quota.used).toBe(1);
  });
});
