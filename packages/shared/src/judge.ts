import { z } from 'zod';

export const LANGUAGES = ['python', 'cpp'] as const;
export type Language = (typeof LANGUAGES)[number];

export const VERDICTS = [
  'ACCEPTED',
  'WRONG_ANSWER',
  'TLE',
  'MLE',
  'RUNTIME_ERROR',
  'COMPILE_ERROR',
] as const;
export type Verdict = (typeof VERDICTS)[number];

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type SubmissionKind = 'RUN' | 'SUBMIT';
export type SubmissionStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';

export const MAX_CODE_BYTES = 64 * 1024;

export const codeSubmissionSchema = z.object({
  language: z.enum(LANGUAGES),
  code: z
    .string()
    .min(1)
    .refine(
      (c) => new TextEncoder().encode(c).length <= MAX_CODE_BYTES,
      'Code is larger than 64 KB',
    ),
});
export type CodeSubmissionInput = z.infer<typeof codeSubmissionSchema>;

export interface ProblemSummary {
  slug: string;
  title: string;
  difficulty: Difficulty;
}

/** A row of the practice list: the summary plus topics, community stats and the caller's own status. */
export interface ProblemListItem extends ProblemSummary {
  tags: string[];
  /** Share of judged SUBMITs (practice and battle) that were accepted; null before the first one. */
  acceptance: number | null;
  /** The caller has an accepted SUBMIT for this problem. */
  solved: boolean;
  /** The caller has submitted at least once. */
  attempted: boolean;
  /** The caller has opened it, so battles will no longer pick it for them (decision.md D-042). */
  seen: boolean;
}

export interface ProblemDetail extends ProblemSummary {
  statement: string;
  /** Effective per-test limit for each language (base limit × language multiplier). */
  timeLimitMs: Record<Language, number>;
  memoryLimitMb: number;
  starterCode: Record<Language, string>;
  samples: { input: string; expected: string }[];
}

export interface TestResultView {
  index: number;
  verdict: Verdict;
  timeMs: number;
  /** Only present for RUN (sample tests). Hidden test I/O is never sent to the client. */
  input?: string;
  expected?: string;
  stdout?: string;
  stderr?: string;
}

export interface SubmissionView {
  id: string;
  problemSlug: string;
  kind: SubmissionKind;
  language: Language;
  status: SubmissionStatus;
  verdict: Verdict | null;
  testsPassed: number | null;
  testsTotal: number | null;
  maxTimeMs: number | null;
  compileOutput: string | null;
  tests: TestResultView[];
  createdAt: string;
}
