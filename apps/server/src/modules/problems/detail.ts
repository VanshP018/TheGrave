import { LANGUAGES, type Language, type ProblemDetail } from '@thegrave/shared';
import type { Problem, TestCase } from '../../generated/prisma/client.js';
import { effectiveTimeLimitMs } from '../../judge/executor.js';
import { prisma } from '../../lib/prisma.js';

/** Public view of a problem: statement, limits, starter code and *sample* tests only. */
export function toProblemDetail(p: Problem & { testCases: TestCase[] }): ProblemDetail {
  return {
    slug: p.slug,
    title: p.title,
    difficulty: p.difficulty,
    statement: p.statement,
    timeLimitMs: Object.fromEntries(
      LANGUAGES.map((l) => [l, effectiveTimeLimitMs(p.timeLimitMs, l)]),
    ) as Record<Language, number>,
    memoryLimitMb: p.memoryLimitMb,
    starterCode: p.starterCode as Record<Language, string>,
    samples: p.testCases
      .filter((t) => t.isSample)
      .map((t) => ({ input: t.input, expected: t.expected })),
  };
}

/** Battles avoid problems a player has seen (decision.md D-042). */
export const markSeen = (userIds: string[], problemId: string) =>
  prisma.seenProblem.createMany({
    data: userIds.map((userId) => ({ userId, problemId })),
    skipDuplicates: true,
  });
