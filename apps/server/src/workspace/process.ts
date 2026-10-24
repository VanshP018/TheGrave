import { HIDDEN_TEST_DIR, type ProjectLanguage } from '@thegrave/shared';
import { scheduleBattleJob } from '../battle/queue.js';
import { prisma } from '../lib/prisma.js';
import type { WorkspaceRunner } from './executor.js';

export const RUN_TIMEOUT_MS = { COMMAND: 10_000, TEST: 20_000, SUBMIT: 20_000 } as const;

/** Runs one ProjectRun and stores the outcome. Safe to call again for the same id (retries). */
export async function processProjectRun(runId: string, runner: WorkspaceRunner): Promise<void> {
  const run = await prisma.projectRun.findUniqueOrThrow({
    where: { id: runId },
    include: { project: { select: { language: true, hiddenTests: true, hiddenTestCount: true } } },
  });
  if (run.status === 'DONE') return;
  await prisma.projectRun.update({ where: { id: runId }, data: { status: 'RUNNING' } });

  const files = run.files as Record<string, string>;
  const language = run.project.language as ProjectLanguage;
  const res =
    run.kind === 'COMMAND'
      ? await runner.run(
          language,
          files,
          { mode: 'exec', command: run.command! },
          RUN_TIMEOUT_MS.COMMAND,
        )
      : run.kind === 'TEST'
        ? await runner.run(language, files, { mode: 'test', testDir: 'tests' }, RUN_TIMEOUT_MS.TEST)
        : // The grading tests are added here, server side; players' files can never land in HIDDEN_TEST_DIR.
          await runner.run(
            language,
            { ...files, ...(run.project.hiddenTests as Record<string, string>) },
            { mode: 'test', testDir: HIDDEN_TEST_DIR },
            RUN_TIMEOUT_MS.SUBMIT,
          );

  const tested = run.kind !== 'COMMAND';
  // Graded against the known size of the hidden suite: tests that never reported (a crash, a timeout,
  // code that exits early) count as failed rather than shrinking the total.
  const total = !tested
    ? null
    : run.kind === 'SUBMIT'
      ? Math.max(run.project.hiddenTestCount, res.results.length)
      : res.results.length;
  await prisma.projectRun.update({
    where: { id: runId },
    data: {
      status: 'DONE',
      exitCode: res.exitCode,
      output: res.output,
      timedOut: res.timedOut,
      timeMs: res.timeMs,
      results: tested ? (res.results as object[]) : undefined,
      passed: tested ? res.results.filter((r) => r.status === 'pass').length : null,
      total,
      finishedAt: new Date(),
    },
  });
  // Battle submissions hand the verdict to the battle queue, like the DSA judge (decision.md D-043).
  if (run.matchId)
    await scheduleBattleJob({ type: 'judged', matchId: run.matchId, submissionId: run.id });
}
