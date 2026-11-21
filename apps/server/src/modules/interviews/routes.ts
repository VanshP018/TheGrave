import {
  interviewCreateSchema,
  parseGithubRepoUrl,
  type InterviewDetail,
  type InterviewErrorCode,
  type InterviewLevel,
  type InterviewListResponse,
  type InterviewQuestionView,
  type InterviewStage,
  type InterviewStatus,
  type InterviewSummary,
} from '@thegrave/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { resolveBudget, type TierBudget } from '../../interviews/budget.js';
import { checkCapacity } from '../../interviews/capacity.js';
import { interviewsEnabled } from '../../interviews/enabled.js';
import { enqueueInterview, interviewsQueue } from '../../interviews/queue.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { userRateLimitKey } from '../../plugins/authenticate.js';

const idParams = z.object({ id: z.uuid() });
const notFound = { error: 'Not Found', message: 'Not found' };
const DAY_MS = 86_400_000;
/** Newest analyses kept per user; older ones are deleted when a new one is created (plan.md 7.2). */
export const INTERVIEW_RETENTION = 50;
/** An active row older than this is treated as abandoned, so a lost job can't block the user forever. */
const STALE_ACTIVE_MS = 60 * 60 * 1000;

type Row = Prisma.InterviewAnalysisGetPayload<{
  include: { _count: { select: { questions: true } } };
}>;

function toSummary(r: Row): InterviewSummary {
  return {
    id: r.id,
    owner: r.repoOwner,
    repo: r.repoName,
    commitSha: r.commitSha,
    requestedLevel: r.requestedLevel,
    apparentLevel: r.apparentLevel,
    status: r.status as InterviewStatus,
    stage: r.stage as InterviewStage,
    errorCode: r.errorCode as InterviewErrorCode | null,
    questionCount: r._count.questions,
    createdAt: r.createdAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

const retryAfter = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/** Interview prep from public GitHub repos (plan.md 5.1). The worker process does the analysis. */
export async function interviewRoutes(
  app: FastifyInstance,
  opts: { enabled?: boolean; budget?: TierBudget },
) {
  const enabled = opts.enabled ?? interviewsEnabled(config);
  const budget = opts.budget ?? resolveBudget(config);
  const models = [
    config.INTERVIEW_MODEL,
    config.INTERVIEW_TRIAGE_MODEL,
    config.INTERVIEW_CRITIQUE_MODEL,
  ];
  const capacity = () =>
    checkCapacity({ redis, budget, models, dailyBudgetUsd: config.INTERVIEW_DAILY_BUDGET_USD });
  app.addHook('onRequest', app.authenticate);

  /** Charged analyses in the last rolling 24 h, and when the oldest one stops counting. */
  async function quotaFor(userId: string) {
    const rows = await prisma.interviewAnalysis.findMany({
      where: { userId, charged: true, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const limit = budget.dailyLimit;
    const used = rows.length;
    const exhausted = used >= limit && rows.length > 0;
    // The slot that frees first is the (used - limit + 1)th oldest.
    const freeing = exhausted ? rows[used - limit]! : null;
    return {
      used,
      limit,
      resetsAt: freeing ? new Date(freeing.createdAt.getTime() + DAY_MS).toISOString() : null,
      retryAtMs: freeing ? freeing.createdAt.getTime() + DAY_MS : null,
    };
  }

  app.get('/interviews', async (req): Promise<InterviewListResponse> => {
    const userId = req.auth!.userId;
    const [rows, quota, cap] = await Promise.all([
      prisma.interviewAnalysis.findMany({
        where: { userId },
        include: { _count: { select: { questions: true } } },
        orderBy: { createdAt: 'desc' },
        take: INTERVIEW_RETENTION,
      }),
      quotaFor(userId),
      capacity(),
    ]);
    return {
      enabled,
      items: rows.map(toSummary),
      quota: { used: quota.used, limit: quota.limit, resetsAt: quota.resetsAt },
      capacity: cap.available
        ? { available: true, retryAt: null }
        : { available: false, retryAt: cap.retryAt.toISOString() },
    };
  });

  app.get('/interviews/:id', async (req, reply): Promise<InterviewDetail | undefined> => {
    const { id } = idParams.parse(req.params);
    // Another user's analysis is a 404, never a 403.
    const r = await prisma.interviewAnalysis.findFirst({
      where: { id, userId: req.auth!.userId },
      include: {
        _count: { select: { questions: true } },
        questions: { orderBy: { position: 'asc' } },
      },
    });
    if (!r) return void reply.code(404).send(notFound);
    const p = r.profile as {
      displayName?: string;
      description?: string | null;
      languages?: { name: string; share: number }[];
      summary?: string;
      focusAreas?: string[];
      fileCount?: number;
    } | null;
    const progress = r.progress as { detail?: string; waitingUntil?: string | null } | null;
    return {
      ...toSummary(r),
      progress: progress
        ? { detail: progress.detail ?? '', waitingUntil: progress.waitingUntil ?? null }
        : null,
      profile: p
        ? {
            displayName: p.displayName ?? `${r.repoOwner}/${r.repoName}`,
            description: p.description ?? null,
            languages: p.languages ?? [],
            summary: p.summary ?? '',
            focusAreas: p.focusAreas ?? [],
            fileCount: p.fileCount ?? 0,
          }
        : null,
      questions: r.questions.map((q): InterviewQuestionView => ({
        position: q.position,
        category: q.category,
        difficulty: q.difficulty,
        question: q.question,
        whyAsked: q.whyAsked,
        evidence: q.evidence as unknown as InterviewQuestionView['evidence'],
        strongAnswer: q.strongAnswer as string[],
        followUps: q.followUps as string[],
        redFlags: q.redFlags as string[],
      })),
    };
  });

  app.post(
    '/interviews',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute', keyGenerator: userRateLimitKey } } },
    async (req, reply) => {
      const input = interviewCreateSchema.parse(req.body);
      const userId = req.auth!.userId;
      if (!enabled)
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'Interview prep is not set up on this server',
        });

      // One POST per user at a time, so two quick clicks can't both pass the checks below.
      const lock = `interviews:post:${userId}`;
      if ((await redis.set(lock, '1', 'EX', 10, 'NX')) !== 'OK')
        return reply
          .code(409)
          .send({ error: 'Conflict', message: 'You already have an analysis running' });
      try {
        const active = await prisma.interviewAnalysis.findFirst({
          where: {
            userId,
            status: { in: ['QUEUED', 'RUNNING'] },
            createdAt: { gte: new Date(Date.now() - STALE_ACTIVE_MS) },
          },
          select: { id: true },
        });
        if (active)
          return reply.code(409).send({
            error: 'Conflict',
            message: 'You already have an analysis running',
            activeId: active.id,
          });

        const quota = await quotaFor(userId);
        if (quota.used >= quota.limit) {
          const retryAfterMs = Math.max(
            1000,
            (quota.retryAtMs ?? Date.now() + DAY_MS) - Date.now(),
          );
          return reply
            .code(429)
            .header('Retry-After', retryAfter(retryAfterMs))
            .send({ error: 'Too Many Requests', message: 'Daily limit reached', retryAfterMs });
        }

        const cap = await capacity();
        if (!cap.available) {
          const retryAfterMs = Math.max(1000, cap.retryAt.getTime() - Date.now());
          return reply.code(503).header('Retry-After', retryAfter(retryAfterMs)).send({
            error: 'Service Unavailable',
            message: 'The AI has reached its limit for today',
            retryAfterMs,
          });
        }
        if ((await interviewsQueue.getWaitingCount()) >= budget.queueMax)
          return reply.code(503).header('Retry-After', '30').send({
            error: 'Service Unavailable',
            message: 'Interview prep is busy, try again shortly',
            retryAfterMs: 30_000,
          });

        // Canonical lower-case names (GitHub treats them case-insensitively), so cache keys line up.
        const repo = parseGithubRepoUrl(input.repoUrl)!;
        const row = await prisma.interviewAnalysis.create({
          data: {
            userId,
            repoOwner: repo.owner.toLowerCase(),
            repoName: repo.repo.toLowerCase(),
            ref: repo.ref,
            requestedLevel: input.level as InterviewLevel,
          },
        });
        try {
          await enqueueInterview(row.id);
        } catch (err) {
          await prisma.interviewAnalysis.delete({ where: { id: row.id } }).catch(() => undefined);
          throw err;
        }
        // Retention: keep the newest INTERVIEW_RETENTION per user.
        const old = await prisma.interviewAnalysis.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          skip: INTERVIEW_RETENTION,
          select: { id: true },
        });
        if (old.length)
          await prisma.interviewAnalysis.deleteMany({
            where: { id: { in: old.map((o) => o.id) } },
          });
        return reply.code(202).send({ id: row.id, status: row.status });
      } finally {
        await redis.del(lock).catch(() => undefined);
      }
    },
  );

  app.delete(
    '/interviews/:id',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: userRateLimitKey } } },
    async (req, reply) => {
      const { id } = idParams.parse(req.params);
      // The worker notices the row is gone at its next stage boundary and stops quietly.
      const { count } = await prisma.interviewAnalysis.deleteMany({
        where: { id, userId: req.auth!.userId },
      });
      if (count === 0) return reply.code(404).send(notFound);
      // Best effort: drop a job that has not started; a running one finds the row gone.
      await interviewsQueue
        .getJob(id)
        .then((job) => job?.remove())
        .catch(() => undefined);
      return reply.code(204).send();
    },
  );
}
