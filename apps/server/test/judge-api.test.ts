import type { SubmissionView } from '@thegrave/shared';
import type { Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DockerExecutor } from '../src/judge/docker-executor.js';
import { JudgeError, type Executor } from '../src/judge/executor.js';
import { submissionsQueue } from '../src/judge/queue.js';
import { createJudgeWorker } from '../src/judge/worker.js';
import { prisma } from '../src/lib/prisma.js';
import { buildTestCases, STARTER_CODE } from '../src/seed/build.js';
import { problems } from '../src/seed/problems.js';
import { closeAll, registerUser, resetState, setupApp } from './helpers.js';

let app: FastifyInstance;
let worker: Worker;
let alice: { authorization: string };
let bob: { authorization: string };

const def = problems.find((p) => p.slug === 'sum-of-array')!;
const tests = buildTestCases(def);
const SOLUTION = 'import sys\nd = sys.stdin.read().split()\nprint(sum(map(int, d[1:])))\n';
const WRONG = 'print(0)\n';

beforeAll(async () => {
  app = await setupApp();
  await resetState();
  await prisma.problem.create({
    data: {
      slug: def.slug,
      title: def.title,
      difficulty: def.difficulty,
      statement: def.statement,
      starterCode: STARTER_CODE,
      testCases: { create: tests },
    },
  });
  alice = await registerUser(app, 'alice');
  bob = await registerUser(app, 'bob');
  worker = createJudgeWorker(new DockerExecutor({ image: 'thegrave-judge:latest' }), {
    concurrency: 2,
  });
});
afterAll(async () => {
  await worker.close();
  await submissionsQueue.close();
  await closeAll(app);
});

const post = (kind: 'run' | 'submit', payload: object, headers = alice) =>
  app.inject({ method: 'POST', url: `/api/problems/${def.slug}/${kind}`, payload, headers });

async function waitFor(id: string, headers = alice): Promise<SubmissionView> {
  for (let i = 0; i < 200; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/submissions/${id}`, headers });
    const body = res.json() as SubmissionView;
    if (body.status === 'DONE' || body.status === 'FAILED') return body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('submission never finished');
}

describe('problems API', () => {
  it('requires authentication', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/problems' })).statusCode).toBe(401);
  });

  it('lists problems and shows a problem with samples only', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/problems', headers: alice });
    expect(list.json()).toEqual([
      {
        slug: 'sum-of-array',
        title: 'Sum of Array',
        difficulty: 'EASY',
        tags: [],
        acceptance: null,
        solved: false,
        attempted: false,
        seen: false,
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/problems/${def.slug}`,
      headers: alice,
    });
    const body = res.json();
    expect(body.timeLimitMs).toEqual({ python: 3000, cpp: 1000 });
    expect(body.starterCode.cpp).toContain('int main');
    expect(body.samples).toHaveLength(def.samples.length);
    // No hidden test leaks into the payload.
    const hidden = tests.filter((t) => !t.isSample);
    for (const t of hidden) expect(res.body).not.toContain(JSON.stringify(t.input).slice(1, 40));
  });

  it('404s unknown problems', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/problems/nope', headers: alice });
    expect(res.statusCode).toBe(404);
  });
});

describe('run & submit through the queue and a real judge', () => {
  it('RUN judges sample tests only and returns full I/O', async () => {
    const res = await post('run', { language: 'python', code: SOLUTION });
    expect(res.statusCode).toBe(202);
    const sub = await waitFor(res.json().id);
    expect(sub).toMatchObject({
      kind: 'RUN',
      status: 'DONE',
      verdict: 'ACCEPTED',
      testsTotal: def.samples.length,
    });
    expect(sub.tests[0]).toMatchObject({ input: def.samples[0], expected: '15\n', stdout: '15\n' });
  });

  it('SUBMIT judges every test and exposes verdicts but not hidden I/O', async () => {
    const ok = await waitFor(
      (await post('submit', { language: 'python', code: SOLUTION })).json().id,
    );
    expect(ok).toMatchObject({
      kind: 'SUBMIT',
      verdict: 'ACCEPTED',
      testsPassed: tests.length,
      testsTotal: tests.length,
    });

    const wrong = await waitFor(
      (await post('submit', { language: 'python', code: WRONG })).json().id,
    );
    expect(wrong.verdict).toBe('WRONG_ANSWER');
    expect(wrong.testsPassed).toBeLessThan(tests.length);
    for (const t of wrong.tests) {
      expect(Object.keys(t).sort()).toEqual(['index', 'timeMs', 'verdict']);
    }
  });

  it('reports compile errors for C++', async () => {
    const sub = await waitFor(
      (await post('submit', { language: 'cpp', code: 'int main( {' })).json().id,
    );
    expect(sub.verdict).toBe('COMPILE_ERROR');
    expect(sub.compileOutput).toBeTruthy();
  });

  it('the practice list reports acceptance and per-user status', async () => {
    const [a] = (await app.inject({ method: 'GET', url: '/api/problems', headers: alice })).json();
    // alice opened the problem above, then submitted an accepted, a wrong and a non-compiling solution.
    expect(a).toMatchObject({ solved: true, attempted: true, seen: true });
    expect(a.acceptance).toBeCloseTo(1 / 3);
    const [b] = (await app.inject({ method: 'GET', url: '/api/problems', headers: bob })).json();
    expect(b).toMatchObject({ solved: false, attempted: false, seen: false });
    expect(b.acceptance).toBeCloseTo(1 / 3);
  });

  it("hides other users' submissions (404)", async () => {
    const id = (await post('run', { language: 'python', code: SOLUTION })).json().id;
    const res = await app.inject({ method: 'GET', url: `/api/submissions/${id}`, headers: bob });
    expect(res.statusCode).toBe(404);
    await waitFor(id);
  });

  it('validates the body', async () => {
    expect((await post('run', { language: 'java', code: 'x' })).statusCode).toBe(400);
    expect((await post('run', { language: 'python', code: '' })).statusCode).toBe(400);
    expect(
      (await post('run', { language: 'python', code: 'x'.repeat(64 * 1024 + 1) })).statusCode,
    ).toBe(400);
  });

  it('rate limits run/submit per user, not per IP', async () => {
    const carol = await registerUser(app, 'carol');
    const codes: number[] = [];
    for (let i = 0; i < 11; i++)
      codes.push((await post('run', { language: 'python', code: SOLUTION }, carol)).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 202)).toBe(true);
    expect(codes[10]).toBe(429);
    // Same IP, different user: not limited.
    const dave = await registerUser(app, 'dave');
    expect((await post('run', { language: 'python', code: SOLUTION }, dave)).statusCode).toBe(202);
  });
});

describe('judge infrastructure failure', () => {
  it('retries, then marks the submission FAILED (not a verdict against the user)', async () => {
    await worker.close();
    // Drain jobs left by the previous test so the broken worker only sees ours.
    await submissionsQueue.drain();
    let calls = 0;
    const broken: Executor = {
      run: async () => {
        calls++;
        throw new JudgeError('docker daemon unreachable');
      },
    };
    worker = createJudgeWorker(broken, { concurrency: 1 });
    const erin = await registerUser(app, 'erin');
    const id = (await post('submit', { language: 'python', code: SOLUTION }, erin)).json().id;
    const sub = await waitFor(id, erin);
    expect(sub.status).toBe('FAILED');
    expect(sub.verdict).toBeNull();
    expect(calls).toBe(3);
  });
});
