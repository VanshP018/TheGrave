import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  codeSubmissionSchema,
  LANGUAGES,
  type Language,
  type ProblemDetail,
  type ProblemSummary,
  type SubmissionKind,
  type SubmissionView,
  type TestResultView,
} from '@thegrave/shared';
import { z } from 'zod';
import { config } from '../../config.js';
import { effectiveTimeLimitMs } from '../../judge/executor.js';
import { enqueueSubmission, submissionsQueue } from '../../judge/queue.js';
import { prisma } from '../../lib/prisma.js';
import { userRateLimitKey } from '../../plugins/authenticate.js';

const slugParams = z.object({ slug: z.string().max(100) });
const idParams = z.object({ id: z.uuid() });

const notFound = { error: 'Not Found', message: 'Not found' };

export async function problemRoutes(app: FastifyInstance) {
  // Problems are only visible to signed-in users (see decision.md D-029).
  app.addHook('onRequest', app.authenticate);

  app.get('/problems', async (): Promise<ProblemSummary[]> => {
    return prisma.problem.findMany({
      select: { slug: true, title: true, difficulty: true },
      orderBy: [{ difficulty: 'asc' }, { title: 'asc' }],
    });
  });

  app.get('/problems/:slug', async (req, reply) => {
    const { slug } = slugParams.parse(req.params);
    const p = await prisma.problem.findUnique({
      where: { slug },
      include: { testCases: { where: { isSample: true }, orderBy: { ordinal: 'asc' } } },
    });
    if (!p) return reply.code(404).send(notFound);
    const body: ProblemDetail = {
      slug: p.slug,
      title: p.title,
      difficulty: p.difficulty,
      statement: p.statement,
      timeLimitMs: Object.fromEntries(
        LANGUAGES.map((l) => [l, effectiveTimeLimitMs(p.timeLimitMs, l)]),
      ) as Record<Language, number>,
      memoryLimitMb: p.memoryLimitMb,
      starterCode: p.starterCode as Record<Language, string>,
      samples: p.testCases.map((t) => ({ input: t.input, expected: t.expected })),
    };
    return body;
  });

  const judgeLimit = {
    rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: userRateLimitKey },
  };

  const enqueue = (kind: SubmissionKind) => async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = slugParams.parse(req.params);
    const { language, code } = codeSubmissionSchema.parse(req.body);
    const problem = await prisma.problem.findUnique({ where: { slug }, select: { id: true } });
    if (!problem) return reply.code(404).send(notFound);

    // Backpressure: fail fast instead of letting latency grow without bound.
    if ((await submissionsQueue.getWaitingCount()) >= config.JUDGE_QUEUE_MAX) {
      return reply
        .code(503)
        .header('Retry-After', '10')
        .send({ error: 'Service Unavailable', message: 'The judge is busy, try again shortly' });
    }

    const sub = await prisma.submission.create({
      data: { userId: req.auth!.userId, problemId: problem.id, kind, language, code },
    });
    await enqueueSubmission(sub.id);
    return reply.code(202).send({ id: sub.id, status: sub.status });
  };

  app.post('/problems/:slug/run', { config: judgeLimit }, enqueue('RUN'));
  app.post('/problems/:slug/submit', { config: judgeLimit }, enqueue('SUBMIT'));

  app.get('/submissions/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const s = await prisma.submission.findUnique({
      where: { id },
      include: { problem: { select: { slug: true } } },
    });
    // 404 (not 403) for other users' submissions, so ids can't be probed.
    if (!s || s.userId !== req.auth!.userId) return reply.code(404).send(notFound);
    const body: SubmissionView = {
      id: s.id,
      problemSlug: s.problem.slug,
      kind: s.kind,
      language: s.language,
      status: s.status,
      verdict: s.verdict,
      testsPassed: s.testsPassed,
      testsTotal: s.testsTotal,
      maxTimeMs: s.maxTimeMs,
      compileOutput: s.compileOutput,
      tests: (s.results as TestResultView[] | null) ?? [],
      createdAt: s.createdAt.toISOString(),
    };
    return body;
  });
}
