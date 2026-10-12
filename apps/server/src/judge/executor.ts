import type { Language, Verdict } from '@thegrave/shared';

export interface ExecTest {
  input: string;
  expected: string;
}

export interface ExecLimits {
  /** Per-test wall-clock limit, already adjusted for the language (see `effectiveTimeLimitMs`). */
  timeLimitMs: number;
  memoryLimitMb: number;
}

export interface ExecTestResult {
  index: number;
  verdict: Verdict;
  timeMs: number;
  stdout: string;
  stderr: string;
}

export interface ExecResult {
  /** ACCEPTED if every test passed, otherwise the verdict of the first failing test. */
  verdict: Verdict;
  passed: number;
  total: number;
  maxTimeMs: number;
  compileOutput: string | null;
  tests: ExecTestResult[];
}

/** Backend-agnostic code execution (decision.md D-008). Every test is always run so partial scores are known. */
export interface Executor {
  run(language: Language, code: string, tests: ExecTest[], limits: ExecLimits): Promise<ExecResult>;
}

/** Infrastructure failure (Docker down, image missing, protocol error): not the user's fault, job may retry. */
export class JudgeError extends Error {}

const TIME_MULTIPLIER: Record<Language, number> = { cpp: 1, python: 3 };

export const effectiveTimeLimitMs = (baseMs: number, language: Language) =>
  baseMs * TIME_MULTIPLIER[language];

/** Token-insensitive to trailing whitespace on each line and trailing blank lines; nothing else. */
export function normaliseOutput(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd();
}

export function summarise(tests: ExecTestResult[], compileOutput: string | null): ExecResult {
  const firstFail = tests.find((t) => t.verdict !== 'ACCEPTED');
  return {
    verdict: firstFail?.verdict ?? 'ACCEPTED',
    passed: tests.filter((t) => t.verdict === 'ACCEPTED').length,
    total: tests.length,
    maxTimeMs: tests.reduce((m, t) => Math.max(m, t.timeMs), 0),
    compileOutput,
    tests,
  };
}
