import type { ProjectDetail, ProjectLanguage } from '@thegrave/shared';
import type { Project } from '../../generated/prisma/client.js';

const TEST_COMMAND: Record<ProjectLanguage, string> = {
  python: 'python3 -m unittest -v',
  node: 'node --test tests/',
};

/** Public view of a project: everything but the hidden tests (decision.md D-066). */
export function toProjectDetail(p: Project): ProjectDetail {
  return {
    slug: p.slug,
    title: p.title,
    difficulty: p.difficulty,
    language: p.language as ProjectLanguage,
    summary: p.summary,
    tags: p.tags,
    statement: p.statement,
    files: p.files as Record<string, string>,
    testCommand: TEST_COMMAND[p.language as ProjectLanguage],
  };
}

/** A SUBMIT run is a full pass only if the whole hidden suite ran and passed. */
export const isFullPass = (
  run: { passed: number | null; total: number | null },
  hiddenTestCount: number,
) => run.total === hiddenTestCount && run.passed === run.total;
