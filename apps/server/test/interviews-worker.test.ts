import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TIER_PROFILES } from '../src/interviews/budget.js';
import { spendKey } from '../src/interviews/capacity.js';
import { InterviewError } from '../src/interviews/errors.js';
import { FakeInterviewLlm } from '../src/interviews/fake-llm.js';
import type { InterviewLlm, LlmUsage } from '../src/interviews/llm.js';
import { MAX_BUSY_DELAYS, processInterview, type ProcessDeps } from '../src/interviews/process.js';
import { enqueueInterview, interviewsQueue } from '../src/interviews/queue.js';
import { MemoryRepoSource, type RepoSource } from '../src/interviews/source.js';
import { TreeCachedSource, treeCacheKey } from '../src/interviews/tree-cache.js';
import { createInterviewWorker } from '../src/interviews/worker.js';
import { prisma } from '../src/lib/prisma.js';
import { redis } from '../src/lib/redis.js';
import { expressApi } from './fixtures/interview-repos.js';
import { closeAll, registerUser, resetState, setupApp } from './helpers.js';

const budget = TIER_PROFILES.developer;
const PRICED = 'openai/gpt-oss-120b';

/** The fake, with usage relabelled as a priced model so cost accounting has something to count. */
class PricedFake extends FakeInterviewLlm implements InterviewLlm {
  private priced(usage: LlmUsage[]) {
    return usage.map((u) => ({ ...u, model: PRICED }));
  }
  override async triage(...a: Parameters<FakeInterviewLlm['triage']>) {
    const r = await super.triage(...a);
    return { ...r, usage: this.priced(r.usage) };
  }
  override async write(...a: Parameters<FakeInterviewLlm['write']>) {
    const r = await super.write(...a);
    return { ...r, usage: this.priced(r.usage) };
  }
  override async critique(...a: Parameters<FakeInterviewLlm['critique']>) {
    const r = await super.critique(...a);
    return { ...r, usage: this.priced(r.usage) };
  }
}

let app: FastifyInstance;
let userId: string;
let otherId: string;

beforeAll(async () => {
  app = await setupApp();
});
afterAll(async () => {
  await interviewsQueue.close();
  await closeAll(app);
});
beforeEach(async () => {
  await resetState();
  await registerUser(app, 'alice');
  await registerUser(app, 'bob');
  userId = (await prisma.user.findFirstOrThrow({ where: { username: 'alice' } })).id;
  otherId = (await prisma.user.findFirstOrThrow({ where: { username: 'bob' } })).id;
});

const memory = () => new MemoryRepoSource(expressApi, { description: 'Orders service' });
const deps = (over: Partial<ProcessDeps> = {}): ProcessDeps => ({
  source: memory(),
  llm: new PricedFake(budget),
  budget,
  models: [PRICED],
  dailyBudgetUsd: 2,
  ...over,
});
const insert = (uid = userId, level: 'AUTO' | 'SENIOR' = 'AUTO') =>
  prisma.interviewAnalysis.create({
    data: { userId: uid, repoOwner: 'acme', repoName: 'orders', requestedLevel: level },
  });
const load = (id: string) =>
  prisma.interviewAnalysis.findUniqueOrThrow({ where: { id }, include: { questions: true } });

/** An LLM whose writer fails (or returns nothing) while triage and critique are the normal fake. */
function failingWriter(fail: () => Promise<never> | { data: { questions: [] }; usage: [] }) {
  const fake = new PricedFake(budget);
  return Object.assign(Object.create(fake) as InterviewLlm, {
    write: async () => fail(),
  });
}

describe('processInterview', () => {
  it('runs the pipeline: DONE with questions, charged, cost recorded and spend counted', async () => {
    const a = await insert();
    const out = await processInterview(a.id, deps());
    expect(out).toEqual({ kind: 'done' });
    const row = await load(a.id);
    expect(row.status).toBe('DONE');
    expect(row.stage).toBe('DONE');
    expect(row.charged).toBe(true);
    expect(row.commitSha).toBe('a'.repeat(40));
    expect(row.cacheKey).toMatch(/^acme\/orders@a{40}#AUTO#v\d+$/);
    expect(row.apparentLevel).toBe('MID');
    expect(row.questions.length).toBeGreaterThanOrEqual(5);
    expect(row.inputTokens).toBeGreaterThan(0);
    expect(row.costMicroUsd).toBeGreaterThan(0);
    expect(Number(await redis.get(spendKey()))).toBe(row.costMicroUsd);
    expect((row.profile as { displayName: string }).displayName).toBe('acme/orders');
    expect(row.finishedAt).not.toBeNull();
    // Idempotent: a redelivered job for a finished row does nothing.
    expect(await processInterview(a.id, deps())).toEqual({ kind: 'skipped' });
  });

  it('serves a repeat of the same repo, commit and level from the cache: free, uncharged, no LLM call', async () => {
    const first = await insert();
    await processInterview(first.id, deps());
    const llm = new PricedFake(budget);
    const second = await insert(otherId);
    expect(await processInterview(second.id, deps({ llm }))).toEqual({ kind: 'done' });
    const row = await load(second.id);
    expect(row.status).toBe('DONE');
    expect(row.cachedFromId).toBe(first.id);
    expect(row.charged).toBe(false);
    expect(row.costMicroUsd).toBe(0);
    expect(llm.calls).toHaveLength(0);
    const original = await load(first.id);
    expect(row.questions.map((q) => q.question).sort()).toEqual(
      original.questions.map((q) => q.question).sort(),
    );
    expect(row.apparentLevel).toBe(original.apparentLevel);
    // Deleting the source leaves the copy intact (cachedFromId is a plain column).
    await prisma.interviewAnalysis.delete({ where: { id: first.id } });
    expect((await load(second.id)).questions.length).toBe(original.questions.length);
  });

  it('does not share the cache across levels or commits', async () => {
    await processInterview((await insert()).id, deps());
    const llm = new PricedFake(budget);
    const senior = await insert(userId, 'SENIOR');
    await processInterview(senior.id, deps({ llm }));
    expect((await load(senior.id)).cachedFromId).toBeNull();
    expect(llm.calls.length).toBeGreaterThan(0);

    const llm2 = new PricedFake(budget);
    const moved = await insert();
    await processInterview(
      moved.id,
      deps({ llm: llm2, source: new MemoryRepoSource(expressApi, { sha: 'b'.repeat(40) }) }),
    );
    expect((await load(moved.id)).cachedFromId).toBeNull();
    expect(llm2.calls.length).toBeGreaterThan(0);
  });

  it('a non-retryable source error fails the row, uncharged, without throwing', async () => {
    const source: RepoSource = Object.assign(Object.create(memory()) as RepoSource, {
      resolve: async () => {
        throw new InterviewError('REPO_NOT_PUBLIC');
      },
    });
    const a = await insert();
    expect(await processInterview(a.id, deps({ source }))).toEqual({
      kind: 'failed',
      code: 'REPO_NOT_PUBLIC',
    });
    const row = await load(a.id);
    expect(row.status).toBe('FAILED');
    expect(row.errorCode).toBe('REPO_NOT_PUBLIC');
    expect(row.charged).toBe(false);
    expect(row.questions).toHaveLength(0);
  });

  it('NO_SOURCE_FILES (docs-only repo) is free', async () => {
    const a = await insert();
    const out = await processInterview(
      a.id,
      deps({ source: new MemoryRepoSource({ 'README.md': '# only docs\n' }) }),
    );
    expect(out).toEqual({ kind: 'failed', code: 'NO_SOURCE_FILES' });
    expect((await load(a.id)).charged).toBe(false);
  });

  it('a busy AI sends the row back to QUEUED with waitingUntil, then fails after the delay limit', async () => {
    const retryAt = new Date(Date.now() + 90_000);
    const busy = failingWriter(async () => {
      throw new InterviewError('AI_BUSY', undefined, { retryable: true, retryAt });
    });
    const a = await insert();
    const out = await processInterview(a.id, deps({ llm: busy }));
    expect(out).toEqual({ kind: 'delayed', until: retryAt });
    const row = await load(a.id);
    expect(row.status).toBe('QUEUED');
    expect(row.stage).toBe('QUEUED');
    expect(row.charged).toBe(false);
    expect(row.progress).toMatchObject({ waitingUntil: retryAt.toISOString() });

    for (let i = 1; i < MAX_BUSY_DELAYS; i++)
      expect((await processInterview(a.id, deps({ llm: busy }))).kind).toBe('delayed');
    expect(await processInterview(a.id, deps({ llm: busy }))).toEqual({
      kind: 'failed',
      code: 'AI_BUSY',
    });
    const done = await load(a.id);
    expect(done.status).toBe('FAILED');
    expect(done.errorCode).toBe('AI_BUSY');
    expect(done.charged).toBe(false);
  });

  it('AI_CAPACITY from the writer fails the row uncharged', async () => {
    const llm = failingWriter(async () => {
      throw new InterviewError('AI_CAPACITY');
    });
    const a = await insert();
    expect(await processInterview(a.id, deps({ llm }))).toEqual({
      kind: 'failed',
      code: 'AI_CAPACITY',
    });
    const row = await load(a.id);
    expect(row.charged).toBe(false);
    expect(row.errorCode).toBe('AI_CAPACITY');
  });

  it('fails uncharged with AI_CAPACITY, before any LLM call, when a global cap is already hit', async () => {
    await redis.set(spendKey(), String(2_000_000));
    const llm = new PricedFake(budget);
    const a = await insert();
    expect(await processInterview(a.id, deps({ llm }))).toEqual({
      kind: 'failed',
      code: 'AI_CAPACITY',
    });
    expect(llm.calls).toHaveLength(0);

    await redis.flushdb();
    await redis.set(
      `interviews:groq:exhausted:${PRICED}`,
      String(Date.now() + 60_000),
      'PX',
      60_000,
    );
    const b = await insert();
    expect((await processInterview(b.id, deps({ llm }))).kind).toBe('failed');
  });

  it('a writer that yields no usable questions ends TOO_FEW_QUESTIONS and keeps the quota charge', async () => {
    const llm = failingWriter(() => ({ data: { questions: [] }, usage: [] }));
    const a = await insert();
    expect(await processInterview(a.id, deps({ llm }))).toEqual({
      kind: 'failed',
      code: 'TOO_FEW_QUESTIONS',
    });
    expect((await load(a.id)).charged).toBe(true);
  });

  it('retryable errors are rethrown for BullMQ until the final attempt, then recorded', async () => {
    const source: RepoSource = Object.assign(Object.create(memory()) as RepoSource, {
      resolve: async () => {
        throw new InterviewError('GITHUB_UNAVAILABLE', undefined, { retryable: true });
      },
    });
    const a = await insert();
    await expect(processInterview(a.id, deps({ source }), { final: false })).rejects.toThrow();
    expect((await load(a.id)).status).toBe('QUEUED');
    expect(await processInterview(a.id, deps({ source }), { final: true })).toEqual({
      kind: 'failed',
      code: 'GITHUB_UNAVAILABLE',
    });
    expect((await load(a.id)).status).toBe('FAILED');
  });

  it('a row deleted mid-run ends quietly and nothing is recreated', async () => {
    const a = await insert();
    const fake = new PricedFake(budget);
    const llm = Object.assign(Object.create(fake) as InterviewLlm, {
      triage: async (...args: Parameters<InterviewLlm['triage']>) => {
        await prisma.interviewAnalysis.delete({ where: { id: a.id } });
        return fake.triage(...args);
      },
    });
    expect(await processInterview(a.id, deps({ llm }))).toEqual({ kind: 'skipped' });
    expect(await prisma.interviewAnalysis.count()).toBe(0);
    expect(await prisma.interviewQuestion.count()).toBe(0);
    // And a row that never existed is a no-op, not an error.
    expect(await processInterview(a.id, deps())).toEqual({ kind: 'skipped' });
  });
});

describe('TreeCachedSource', () => {
  it('fetches a commit tree once and serves it from Redis afterwards', async () => {
    const inner = memory();
    let calls = 0;
    const counting: RepoSource = Object.assign(Object.create(inner) as RepoSource, {
      tree: (...args: Parameters<RepoSource['tree']>) => (calls++, inner.tree(...args)),
    });
    const cached = new TreeCachedSource(counting, redis);
    const meta = await inner.resolve({ owner: 'Acme', repo: 'Orders', ref: null });
    const s = new AbortController().signal;
    const a = await cached.tree(meta, s);
    const b = await cached.tree(meta, s);
    expect(calls).toBe(1);
    expect(b).toEqual(a);
    expect(await redis.ttl(treeCacheKey(meta))).toBeGreaterThan(0);
    expect(treeCacheKey(meta)).toBe(`interviews:gh:acme/orders@${meta.sha}:tree`);

    // A different commit is a different entry.
    await cached.tree({ ...meta, sha: 'c'.repeat(40) }, s);
    expect(calls).toBe(2);
  });
});

describe('createInterviewWorker (BullMQ)', () => {
  it('processes a queued job end to end', async () => {
    const worker = createInterviewWorker(deps(), { concurrency: 1 });
    try {
      const a = await insert();
      await enqueueInterview(a.id);
      const deadline = Date.now() + 30_000;
      let row = await load(a.id);
      while (row.status !== 'DONE' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        row = await load(a.id);
      }
      expect(row.status).toBe('DONE');
      expect(row.questions.length).toBeGreaterThanOrEqual(5);
    } finally {
      await worker.close();
    }
  });
});
