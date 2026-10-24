import type { Difficulty } from '@thegrave/shared';

/**
 * "Programming" challenges (decision.md D-066): a small codebase with planted bugs. Players edit any file;
 * Submit runs `hiddenTests` (never sent to the client) next to their files. `solution` overrides some
 * files with the fixed versions: the test suite checks the starter fails and the solution passes.
 */
export interface ProjectDef {
  slug: string;
  title: string;
  difficulty: Difficulty;
  language: 'python' | 'node';
  summary: string;
  tags: string[];
  statement: string;
  files: Record<string, string>;
  hiddenTests: Record<string, string>;
  solution: Record<string, string>;
}

/** Strip the common indentation so sources can be written inline; always ends with one newline. */
export function src(s: string): string {
  const ls = s.replace(/^\n/, '').replace(/\s+$/, '').split('\n');
  const indent = Math.min(...ls.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  return ls.map((l) => l.slice(indent)).join('\n') + '\n';
}
