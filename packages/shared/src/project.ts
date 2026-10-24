import { z } from 'zod';
import type { Difficulty, SubmissionStatus } from './judge.js';

/** "Programming" challenges (decision.md D-066): debug a small multi-file codebase in a sandbox. */
export type ProjectLanguage = 'python' | 'node';
export type ProjectRunKind = 'COMMAND' | 'TEST' | 'SUBMIT';

export interface ProjectSummary {
  slug: string;
  title: string;
  difficulty: Difficulty;
  language: ProjectLanguage;
  summary: string;
  tags: string[];
  fileCount: number;
  /** The caller passed every hidden test at least once. */
  solved: boolean;
  /** The caller submitted at least once. */
  attempted: boolean;
}

export interface ProjectDetail extends Omit<ProjectSummary, 'solved' | 'attempted' | 'fileCount'> {
  statement: string;
  /** The starter codebase. Hidden tests never leave the server. */
  files: Record<string, string>;
  /** What the visible tests run with in the terminal. */
  testCommand: string;
}

export interface ProjectTestResult {
  name: string;
  status: 'pass' | 'fail' | 'error';
  message: string;
}

export interface ProjectRunView {
  id: string;
  kind: ProjectRunKind;
  status: SubmissionStatus;
  command: string | null;
  exitCode: number | null;
  output: string | null;
  timedOut: boolean;
  passed: number | null;
  total: number | null;
  results: ProjectTestResult[];
  timeMs: number | null;
  createdAt: string;
}

/** Folder the grading tests are mounted into; players can't write there. */
export const HIDDEN_TEST_DIR = '__grave__';
export const PROJECT_MAX_FILES = 60;
export const PROJECT_MAX_BYTES = 256 * 1024;

const path = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.\-/ ]+$/, 'unsupported characters in a file path')
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !p.split('/').some((seg) => seg === '..' || seg === '') &&
      p.split('/')[0] !== HIDDEN_TEST_DIR,
    'invalid file path',
  );

/** A player's copy of a codebase: path rules, at most 60 files and 256 KB. */
export const projectFilesSchema = z
  .record(path, z.string())
  .refine((f) => Object.keys(f).length <= PROJECT_MAX_FILES, 'too many files')
  .refine(
    (f) =>
      Object.entries(f).reduce((n, [p, c]) => n + new TextEncoder().encode(p + c).length, 0) <=
      PROJECT_MAX_BYTES,
    'the project is larger than 256 KB',
  );

export const projectRunSchema = z
  .object({
    kind: z.enum(['COMMAND', 'TEST', 'SUBMIT']),
    command: z.string().trim().min(1).max(500).optional(),
    files: projectFilesSchema,
  })
  .refine((r) => r.kind !== 'COMMAND' || !!r.command, 'a command is required');

/** Body of a programming battle's submit (decision.md D-067). */
export const projectSubmissionSchema = z.object({ files: projectFilesSchema });
export type ProjectRunInput = z.infer<typeof projectRunSchema>;

/** One turn of the hint bot's conversation (decision.md D-075). */
export const hintMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(2000),
});

/** Body of a hint question: the chat so far (last turn is the player's) plus their current workspace. */
export const hintRequestSchema = z.object({
  messages: z
    .array(hintMessageSchema)
    .min(1)
    .max(20)
    .refine((m) => m.at(-1)?.role === 'user', 'the last message must be from the user'),
  files: projectFilesSchema,
  activeFile: z.string().max(200).optional(),
});
export type HintMessage = z.infer<typeof hintMessageSchema>;
export type HintRequest = z.infer<typeof hintRequestSchema>;
export interface HintResponse {
  reply: string;
}
