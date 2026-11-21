import type { InterviewErrorCode, InterviewStage, RepoRef } from '@thegrave/shared';
import type { Redis } from 'ioredis';
import { Prisma } from '../generated/prisma/client.js';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { redis as defaultRedis } from '../lib/redis.js';
import type { TierBudget } from './budget.js';
import { checkCapacity, recordSpend } from './capacity.js';
import { costMicroUsd } from './cost.js';
import { InterviewError } from './errors.js';
import {
  LlmOutputError,
  type CritiqueInput,
  type InterviewLlm,
  type InterviewLogger,
  type LlmUsage,
  type StageOptions,
  type StageResult,
  type TriageInput,
  type WriteInput,
} from './llm.js';
import { runPipeline } from './pipeline.js';
import { PIPELINE_VERSION } from './prompts.js';
import type { HistorySignals, RepoMeta, RepoSource, TreeEntry } from './source.js';

/** A finished analysis is reusable for this long (plan.md 6.2). */
export const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** An AI_BUSY analysis is delayed and retried this many times before it fails. */
export const MAX_BUSY_DELAYS = 3;
const DEFAULT_BUSY_DELAY_MS = 30_000;

/** Only these failures after the write stage started cost the user a daily-quota slot (plan.md 5.4). */
const CHARGED_ERRORS = new Set<InterviewErrorCode>([
  'TOO_FEW_QUESTIONS',
  'AI_REFUSED',
  'TIMEOUT',
  'INTERNAL',
]);

export interface ProcessDeps {
  source: RepoSource;
  llm: InterviewLlm;
  budget: TierBudget;
  log?: InterviewLogger;
  redis?: Redis;
  /** Writer, triage and critique model ids, for the capacity check. Default: from config. */
  models?: string[];
  /** Global daily spend cap in USD, 0 = none. Default: from config. */
  dailyBudgetUsd?: number;
  now?: () => number;
}

export interface ProcessOptions {
  /** True on the last BullMQ attempt: a retryable failure is then recorded instead of rethrown. */
  final?: boolean;
}

export type ProcessOutcome =
  | { kind: 'done' }
  | { kind: 'failed'; code: InterviewErrorCode }
  /** Row already finished, or deleted: nothing to do. */
  | { kind: 'skipped' }
  /** AI busy: the row is QUEUED again and the job should be delayed until `until`. */
  | { kind: 'delayed'; until: Date };

export const cacheKeyFor = (owner: string, repo: string, sha: string, level: string) =>
  `${owner}/${repo}@${sha}#${level}#v${PIPELINE_VERSION}`;

type Json = Prisma.InputJsonValue;

/** Wraps the LLM so every call's usage is counted (and added to the global spend) even if the pipeline fails later. */
class MeteredLlm implements InterviewLlm {
  inputTokens = 0;
  outputTokens = 0;
  cacheReadTokens = 0;
  costMicroUsd = 0;
  calls = 0;

  constructor(
    private readonly inner: InterviewLlm,
    private readonly onUsage: (usage: LlmUsage[]) => Promise<void>,
  ) {}

  private async record(usage: LlmUsage[]) {
    for (const u of usage) {
      this.calls++;
      this.inputTokens += u.inputTokens;
      this.outputTokens += u.outputTokens;
      this.cacheReadTokens += u.cachedInputTokens;
      this.costMicroUsd += costMicroUsd(u);
    }
    await this.onUsage(usage);
  }

  private async meter<T>(call: Promise<StageResult<T>>): Promise<StageResult<T>> {
    try {
      const r = await call;
      await this.record(r.usage);
      return r;
    } catch (err) {
      if (err instanceof LlmOutputError) await this.record(err.usage);
      throw err;
    }
  }

  triage(input: TriageInput, signal: AbortSignal, opts?: StageOptions) {
    return this.meter(this.inner.triage(input, signal, opts));
  }
  write(input: WriteInput, signal: AbortSignal, opts?: StageOptions) {
    return this.meter(this.inner.write(input, signal, opts));
  }
  critique(input: CritiqueInput, signal: AbortSignal, opts?: StageOptions) {
    return this.meter(this.inner.critique(input, signal, opts));
  }
}

/** Hands the pipeline the metadata already fetched for the cache check instead of asking GitHub twice. */
class ResolvedSource implements RepoSource {
  constructor(
    private readonly inner: RepoSource,
    private readonly meta: RepoMeta,
  ) {}
  resolve = async () => this.meta;
  tree = (meta: RepoMeta, s: AbortSignal): Promise<{ entries: TreeEntry[]; truncated: boolean }> =>
    this.inner.tree(meta, s);
  readFile = (meta: RepoMeta, path: string, max: number, s: AbortSignal) =>
    this.inner.readFile(meta, path, max, s);
  history = (meta: RepoMeta, s: AbortSignal): Promise<HistorySignals> =>
    this.inner.history(meta, s);
}

/**
 * Runs one analysis and stores the outcome. Safe to call again for the same id (queue retries, redelivery):
 * a finished or deleted row returns immediately. Non-retryable InterviewErrors are recorded and swallowed so
 * BullMQ does not retry user-caused failures; retryable ones are rethrown until the last attempt.
 */
export async function processInterview(
  analysisId: string,
  deps: ProcessDeps,
  opts: ProcessOptions = {},
): Promise<ProcessOutcome> {
  const { source, budget, log } = deps;
  const redis = deps.redis ?? defaultRedis;
  const now = deps.now ?? Date.now;
  const row = await prisma.interviewAnalysis.findUnique({ where: { id: analysisId } });
  if (!row || row.status === 'DONE' || row.status === 'FAILED') return { kind: 'skipped' };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), budget.jobTimeoutMs);
  let deleted = false;
  let chargedStarted = false;
  let lastDetail = 'Starting';
  const startedAt = now();
  let current: { stage: string; at: number } | null = null;
  const stageMs: Record<string, number> = {};
  const tag = { analysisId, userId: row.userId, owner: row.repoOwner, repo: row.repoName };

  // Row writes are chained so stage changes land in order; a write that finds the row gone stops the job.
  let chain: Promise<unknown> = Promise.resolve();
  const write = (data: Prisma.InterviewAnalysisUpdateManyMutationInput) => {
    chain = chain
      .then(async () => {
        const r = await prisma.interviewAnalysis.updateMany({ where: { id: analysisId }, data });
        if (r.count === 0) {
          deleted = true;
          ctl.abort();
        }
      })
      .catch((err) => log?.warn({ ...tag, err: String(err) }, 'interview_row_update_failed'));
    return chain;
  };

  const metered = new MeteredLlm(deps.llm, async (usage) => {
    const micro = usage.reduce((n, u) => n + costMicroUsd(u), 0);
    await recordSpend(redis, micro, now()).catch(() => undefined);
  });
  const totals = () => ({
    inputTokens: metered.inputTokens,
    outputTokens: metered.outputTokens,
    cacheReadTokens: metered.cacheReadTokens,
    costMicroUsd: metered.costMicroUsd,
  });
  const finishFailed = async (code: InterviewErrorCode) => {
    await write({
      status: 'FAILED',
      stage: 'QUEUED',
      errorCode: code,
      charged: chargedStarted && CHARGED_ERRORS.has(code),
      progress: Prisma.JsonNull,
      finishedAt: new Date(),
      ...totals(),
    });
    return { kind: 'failed', code } as const;
  };

  try {
    await write({
      status: 'RUNNING',
      stage: 'FETCHING',
      errorCode: null,
      startedAt: row.startedAt ?? new Date(),
      progress: { detail: 'Reading repository metadata', waitingUntil: null },
    });
    await chain;
    if (deleted) return { kind: 'skipped' };

    const ref: RepoRef = { owner: row.repoOwner, repo: row.repoName, ref: row.ref };
    const meta = await source.resolve(ref, ctl.signal);
    if (deleted) return { kind: 'skipped' };
    const cacheKey = cacheKeyFor(row.repoOwner, row.repoName, meta.sha, row.requestedLevel);
    await write({ commitSha: meta.sha, cacheKey });

    // Result cache: the same repo, commit and level was analysed before (by anyone): copy, spend nothing.
    const hit = await prisma.interviewAnalysis.findFirst({
      where: {
        cacheKey,
        status: 'DONE',
        id: { not: analysisId },
        finishedAt: { gte: new Date(now() - CACHE_MAX_AGE_MS) },
        questions: { some: {} },
      },
      orderBy: { finishedAt: 'desc' },
      include: { questions: { orderBy: { position: 'asc' } } },
    });
    if (hit) {
      await chain;
      if (deleted) return { kind: 'skipped' };
      const ok = await prisma
        .$transaction(async (tx) => {
          const r = await tx.interviewAnalysis.updateMany({
            where: { id: analysisId },
            data: {
              status: 'DONE',
              stage: 'DONE',
              progress: Prisma.JsonNull,
              profile: (hit.profile ?? Prisma.JsonNull) as Json,
              apparentLevel: hit.apparentLevel,
              cachedFromId: hit.id,
              charged: false,
              errorCode: null,
              metrics: { cached: true },
              finishedAt: new Date(),
            },
          });
          if (r.count === 0) return false;
          await tx.interviewQuestion.deleteMany({ where: { analysisId } });
          await tx.interviewQuestion.createMany({
            data: hit.questions.map((q) => ({
              analysisId,
              position: q.position,
              category: q.category,
              difficulty: q.difficulty,
              question: q.question,
              whyAsked: q.whyAsked,
              evidence: q.evidence as Json,
              strongAnswer: q.strongAnswer as Json,
              followUps: q.followUps as Json,
              redFlags: q.redFlags as Json,
            })),
          });
          return true;
        })
        .catch((err) => {
          if (isRowGone(err)) return false;
          throw err;
        });
      log?.info({ ...tag, sha: meta.sha, cachedFromId: hit.id }, 'interview_cache_hit');
      return ok ? { kind: 'done' } : { kind: 'skipped' };
    }

    // Global caps again before any Groq spend: a cap hit since POST fails the analysis, uncharged.
    const cap = await checkCapacity({
      redis,
      budget,
      models: deps.models ?? [
        config.INTERVIEW_MODEL,
        config.INTERVIEW_TRIAGE_MODEL,
        config.INTERVIEW_CRITIQUE_MODEL,
      ],
      dailyBudgetUsd: deps.dailyBudgetUsd ?? config.INTERVIEW_DAILY_BUDGET_USD,
      now,
    });
    if (!cap.available) throw new InterviewError('AI_CAPACITY');

    const result = await runPipeline(
      {
        source: new ResolvedSource(source, meta),
        llm: metered,
        budget,
        log,
        now,
        onStage: (stage: InterviewStage, detail: string) => {
          const t = now();
          if (current) stageMs[current.stage] = (stageMs[current.stage] ?? 0) + (t - current.at);
          current = { stage, at: t };
          lastDetail = detail;
          log?.info({ ...tag, sha: meta.sha, stage }, 'interview_stage');
          if (stage === 'WRITING' && !chargedStarted) chargedStarted = true;
          void write({
            status: 'RUNNING',
            stage,
            progress: { detail, waitingUntil: null },
            ...(stage === 'WRITING' ? { charged: true } : {}),
          });
        },
        onWait: (until) =>
          void write({
            progress: { detail: 'Waiting for AI capacity', waitingUntil: until.toISOString() },
          }),
      },
      ref,
      row.requestedLevel,
      ctl.signal,
    );
    await chain;
    if (deleted) return { kind: 'skipped' };

    const profile = {
      displayName: result.profile.displayName,
      description: result.profile.description,
      languages: result.profile.languages,
      summary: result.summary,
      focusAreas: result.focusAreas,
      fileCount: result.profile.fileCount,
      truncatedTree: result.profile.truncatedTree,
    };
    const ok = await prisma
      .$transaction(async (tx) => {
        const r = await tx.interviewAnalysis.updateMany({
          where: { id: analysisId },
          data: {
            status: 'DONE',
            stage: 'DONE',
            progress: Prisma.JsonNull,
            profile,
            apparentLevel: result.apparentLevel,
            charged: true,
            errorCode: null,
            finishedAt: new Date(),
            metrics: {
              ...result.metrics,
              llmCalls: metered.calls,
              rejected: result.metrics.rejectedByReason,
              totalMs: now() - startedAt,
              stageMs,
              delays: delaysOf(row.metrics),
            } as unknown as Json,
            ...totals(),
          },
        });
        if (r.count === 0) return false;
        await tx.interviewQuestion.deleteMany({ where: { analysisId } });
        await tx.interviewQuestion.createMany({
          data: result.questions.map((q) => ({
            analysisId,
            position: q.position,
            category: q.category,
            difficulty: q.difficulty,
            question: q.question,
            whyAsked: q.whyAsked,
            evidence: q.evidence as unknown as Json,
            strongAnswer: q.strongAnswer,
            followUps: q.followUps,
            redFlags: q.redFlags,
          })),
        });
        return true;
      })
      .catch((err) => {
        if (isRowGone(err)) return false;
        throw err;
      });
    log?.info(
      {
        ...tag,
        sha: meta.sha,
        questions: result.questions.length,
        costMicroUsd: metered.costMicroUsd,
      },
      'interview_done',
    );
    return ok ? { kind: 'done' } : { kind: 'skipped' };
  } catch (err) {
    await chain;
    if (deleted) return { kind: 'skipped' };
    const e =
      err instanceof InterviewError
        ? err
        : ctl.signal.aborted
          ? new InterviewError('TIMEOUT')
          : null;
    log?.warn(
      { ...tag, code: e?.code ?? 'INTERNAL', err: e ? undefined : String(err) },
      'interview_failed',
    );

    if (e?.code === 'AI_BUSY' && e.retryable) {
      const delays = delaysOf(row.metrics);
      if (delays < MAX_BUSY_DELAYS) {
        const until = e.retryAt ?? new Date(now() + DEFAULT_BUSY_DELAY_MS);
        await write({
          status: 'QUEUED',
          stage: 'QUEUED',
          charged: false,
          progress: {
            detail: 'AI is busy — retrying automatically',
            waitingUntil: until.toISOString(),
          },
          metrics: { delays: delays + 1 },
          ...totals(),
        });
        await chain;
        return deleted ? { kind: 'skipped' } : { kind: 'delayed', until };
      }
      return finishFailed('AI_BUSY');
    }
    if (e && !e.retryable) return finishFailed(e.code);

    // Retryable (GitHub/Groq unavailable) or unknown: let BullMQ retry, record the failure on the last attempt.
    const code: InterviewErrorCode = e?.code ?? 'INTERNAL';
    if (!opts.final) {
      await write({
        status: 'QUEUED',
        stage: 'QUEUED',
        charged: false,
        progress: { detail: lastDetail, waitingUntil: null },
        ...totals(),
      });
      await chain;
      throw err;
    }
    return finishFailed(code);
  } finally {
    clearTimeout(timer);
  }
}

function delaysOf(metrics: unknown): number {
  const d = (metrics as { delays?: unknown } | null)?.delays;
  return typeof d === 'number' ? d : 0;
}

/** The row vanished between the existence check and the insert (user deleted the analysis mid-run). */
function isRowGone(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === 'P2003' || err.code === 'P2025')
  );
}
