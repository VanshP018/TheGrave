import {
  hintRequestSchema,
  projectRunSchema,
  type HintResponse,
  type ProjectLanguage,
  type ProjectRunView,
  type ProjectSummary,
  type ProjectTestResult,
} from '@thegrave/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { createHintModel, HintError, type HintModel } from '../../hints/model.js';
import { buildHintRequest } from '../../hints/prompt.js';
import { prisma } from '../../lib/prisma.js';
import { userRateLimitKey } from '../../plugins/authenticate.js';
import { isFullPass, toProjectDetail } from './detail.js';
import { enqueueWorkspaceRun, workspaceQueue } from '../../workspace/queue.js';

const slugParams = z.object({ slug: z.string().max(100) });
const idParams = z.object({ id: z.uuid() });
const notFound = { error: 'Not Found', message: 'Not found' };

/** Programming challenges: browse, open, and run code in the workspace sandbox (decision.md D-066). */
export async function projectRoutes(app: FastifyInstance, opts: { hintModel?: HintModel | null }) {
  // Injectable for tests; `null` means "not set up". The hint bot answers practice questions (D-075).
  const hintModel = opts.hintModel === undefined ? createHintModel() : opts.hintModel;
  app.addHook('onRequest', app.authenticate);

  app.get('/projects', async (req): Promise<ProjectSummary[]> => {
    const userId = req.auth!.userId;
    const [projects, mine] = await Promise.all([
      prisma.project.findMany({
        select: {
          id: true,
          slug: true,
          title: true,
          difficulty: true,
          language: true,
          summary: true,
          tags: true,
          files: true,
          hiddenTestCount: true,
        },
        orderBy: [{ difficulty: 'asc' }, { title: 'asc' }],
      }),
      prisma.projectRun.findMany({
        where: { userId, kind: 'SUBMIT', status: 'DONE' },
        select: { projectId: true, passed: true, total: true },
      }),
    ]);
    return projects.map(({ id, files, hiddenTestCount, ...p }) => {
      const runs = mine.filter((r) => r.projectId === id);
      return {
        ...p,
        language: p.language as ProjectLanguage,
        fileCount: Object.keys(files as object).length,
        attempted: runs.length > 0,
        solved: runs.some((r) => isFullPass(r, hiddenTestCount)),
      };
    });
  });

  app.get('/projects/:slug', async (req, reply) => {
    const { slug } = slugParams.parse(req.params);
    const p = await prisma.project.findUnique({ where: { slug } });
    if (!p) return reply.code(404).send(notFound);
    return toProjectDetail(p);
  });

  app.post(
    '/projects/:slug/runs',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute', keyGenerator: userRateLimitKey } } },
    async (req, reply) => {
      const { slug } = slugParams.parse(req.params);
      const input = projectRunSchema.parse(req.body);
      const project = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
      if (!project) return reply.code(404).send(notFound);
      // Mid-battle, the hidden suite is only reachable through the battle's own submit (one attempt per
      // cooldown, counted, visible to the opponent): practice Submit on that codebase is off until it ends.
      if (input.kind === 'SUBMIT') {
        const live = await prisma.match.count({
          where: {
            projectId: project.id,
            status: { in: ['PENDING', 'ACTIVE'] },
            players: { some: { userId: req.auth!.userId } },
          },
        });
        if (live)
          return reply.code(409).send({
            error: 'Conflict',
            message: 'You are in a battle on this codebase: submit through the battle',
          });
      }
      if ((await workspaceQueue.getWaitingCount()) >= config.JUDGE_QUEUE_MAX) {
        return reply.code(503).header('Retry-After', '10').send({
          error: 'Service Unavailable',
          message: 'The sandbox is busy, try again shortly',
        });
      }
      const run = await prisma.projectRun.create({
        data: {
          userId: req.auth!.userId,
          projectId: project.id,
          kind: input.kind,
          command: input.kind === 'COMMAND' ? input.command! : null,
          files: input.files,
        },
      });
      await enqueueWorkspaceRun(run.id);
      return reply.code(202).send({ id: run.id, status: run.status });
    },
  );

  // Hints for the current challenge: nudges only, never the bug or the fix (decision.md D-075).
  app.post(
    '/projects/:slug/hint',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute', keyGenerator: userRateLimitKey } } },
    async (req, reply) => {
      const { slug } = slugParams.parse(req.params);
      const input = hintRequestSchema.parse(req.body);
      // `hiddenTests` is deliberately not selected: it must never get near the model.
      const project = await prisma.project.findUnique({
        where: { slug },
        select: {
          id: true,
          title: true,
          difficulty: true,
          language: true,
          statement: true,
          files: true,
        },
      });
      if (!project) return reply.code(404).send(notFound);
      if (!hintModel) {
        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'AI hints are not set up on this server',
        });
      }
      // Same guard as practice Submit: a battle on this codebase is a contest, no outside help.
      const live = await prisma.match.count({
        where: {
          projectId: project.id,
          status: { in: ['PENDING', 'ACTIVE'] },
          players: { some: { userId: req.auth!.userId } },
        },
      });
      if (live)
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Hints are off during a battle on this codebase',
        });
      try {
        const text = await hintModel.reply(
          buildHintRequest({
            project: { ...project, files: project.files as Record<string, string> },
            files: input.files,
            activeFile: input.activeFile,
            history: input.messages,
          }),
        );
        const body: HintResponse = { reply: text };
        return body;
      } catch (err) {
        if (!(err instanceof HintError)) throw err;
        if (err.code === 'busy')
          return reply.code(429).send({
            error: 'Too Many Requests',
            message: 'The hint assistant is busy, try again in a moment',
          });
        if (err.code === 'unconfigured')
          return reply.code(503).send({
            error: 'Service Unavailable',
            message: 'AI hints are not set up on this server',
          });
        return reply.code(502).send({
          error: 'Bad Gateway',
          message: 'The hint assistant is unavailable right now',
        });
      }
    },
  );

  app.get('/project-runs/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const r = await prisma.projectRun.findUnique({ where: { id } });
    // 404 (not 403) for other users' runs, so ids can't be probed.
    if (!r || r.userId !== req.auth!.userId) return reply.code(404).send(notFound);
    const body: ProjectRunView = {
      id: r.id,
      kind: r.kind,
      status: r.status,
      command: r.command,
      exitCode: r.exitCode,
      output: r.output,
      timedOut: r.timedOut,
      passed: r.passed,
      total: r.total,
      results: (r.results as ProjectTestResult[] | null) ?? [],
      timeMs: r.timeMs,
      createdAt: r.createdAt.toISOString(),
    };
    return body;
  });
}
