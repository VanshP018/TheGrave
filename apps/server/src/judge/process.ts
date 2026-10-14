import type { TestResultView } from '@thegrave/shared';
import { scheduleBattleJob } from '../battle/queue.js';
import { prisma } from '../lib/prisma.js';
import { effectiveTimeLimitMs, type Executor } from './executor.js';

const RUN_STDOUT_LIMIT = 4096;
const RUN_STDERR_LIMIT = 2048;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… (truncated)` : s);

/** Judges one submission and persists the result. Safe to call again for the same id (retries). */
export async function processSubmission(submissionId: string, executor: Executor): Promise<void> {
  const sub = await prisma.submission.findUniqueOrThrow({ where: { id: submissionId } });
  if (sub.status === 'DONE') return;

  const problem = await prisma.problem.findUniqueOrThrow({
    where: { id: sub.problemId },
    include: {
      testCases: {
        where: sub.kind === 'RUN' ? { isSample: true } : {},
        orderBy: { ordinal: 'asc' },
      },
    },
  });
  await prisma.submission.update({ where: { id: sub.id }, data: { status: 'RUNNING' } });

  const res = await executor.run(sub.language, sub.code, problem.testCases, {
    timeLimitMs: effectiveTimeLimitMs(problem.timeLimitMs, sub.language),
    memoryLimitMb: problem.memoryLimitMb,
  });

  // Hidden test I/O never leaves the server: SUBMIT results carry verdicts and timings only.
  const results: TestResultView[] = res.tests.map((t) => {
    const base = { index: t.index, verdict: t.verdict, timeMs: t.timeMs };
    if (sub.kind !== 'RUN') return base;
    const tc = problem.testCases[t.index]!;
    return {
      ...base,
      input: tc.input,
      expected: tc.expected,
      stdout: clip(t.stdout, RUN_STDOUT_LIMIT),
      stderr: clip(t.stderr, RUN_STDERR_LIMIT),
    };
  });

  await prisma.submission.update({
    where: { id: sub.id },
    data: {
      status: 'DONE',
      verdict: res.verdict,
      testsPassed: res.passed,
      testsTotal: res.total,
      maxTimeMs: res.maxTimeMs,
      compileOutput: res.compileOutput,
      results: results as object[],
      finishedAt: new Date(),
    },
  });
  // The judge stays battle-agnostic: it only hands the verdict to the battle queue (decision.md D-043).
  if (sub.matchId)
    await scheduleBattleJob({ type: 'judged', matchId: sub.matchId, submissionId: sub.id });
}
