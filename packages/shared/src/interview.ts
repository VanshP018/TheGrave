import { z } from 'zod';
import type { Difficulty } from './judge.js';

/** Interview prep from a public GitHub repository (plan.md). */
export type InterviewStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
export type InterviewStage = 'QUEUED' | 'FETCHING' | 'READING' | 'WRITING' | 'REVIEWING' | 'DONE';
export type InterviewLevel = 'AUTO' | 'INTERN' | 'JUNIOR' | 'MID' | 'SENIOR';
export const INTERVIEW_CATEGORIES = [
  'ARCHITECTURE',
  'DESIGN_TRADEOFF',
  'CODE_QUALITY',
  'BUG_RISK',
  'TESTING',
  'PERFORMANCE_SCALING',
  'SECURITY',
  'DEPENDENCIES',
  'DATA_MODEL',
  'DEVOPS',
] as const;
export type InterviewCategory = (typeof INTERVIEW_CATEGORIES)[number];
export type InterviewErrorCode =
  | 'REPO_NOT_FOUND'
  | 'REPO_NOT_PUBLIC'
  | 'REPO_EMPTY'
  | 'REPO_TOO_LARGE'
  | 'NO_SOURCE_FILES'
  | 'GITHUB_RATE_LIMITED'
  | 'GITHUB_UNAVAILABLE'
  | 'AI_BUSY'
  | 'AI_CAPACITY'
  | 'AI_UNAVAILABLE'
  | 'AI_REFUSED'
  | 'TOO_FEW_QUESTIONS'
  | 'TIMEOUT'
  | 'INTERNAL';

export interface RepoRef {
  owner: string;
  repo: string;
  ref: string | null;
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9._/-]{1,100}$/;

function validRepo(owner: string, repo: string): boolean {
  return OWNER_RE.test(owner) && REPO_RE.test(repo) && repo !== '.' && repo !== '..';
}

/**
 * Strict: https://github.com/<owner>/<repo>[.git][/][/tree/<ref>] or "owner/repo" (http, www. and a missing
 * scheme are normalised). Null if anything else. The server never fetches the input string itself; it builds
 * URLs from the returned parts.
 */
export function parseGithubRepoUrl(input: string): RepoRef | null {
  const text = input.trim();
  if (!text || /[\s\\]/.test(text)) return null;

  let path: string;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text);
  const bare = /^(?:www\.)?github\.com\//i.test(text);
  if (scheme || bare) {
    let url: URL;
    try {
      url = new URL(scheme ? text : `https://${text}`);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
    if (url.username || url.password || url.port) return null;
    path = url.pathname;
  } else {
    // "owner/repo" shorthand: no query, fragment or host-like prefix
    if (/[?#]/.test(text)) return null;
    path = `/${text}`;
  }

  const parts = path.replace(/\/+$/, '').split('/').slice(1);
  if (parts.length !== 2 && !(parts.length >= 4 && parts[2] === 'tree')) return null;
  const owner = parts[0]!;
  let repo = parts[1]!;
  if (repo.endsWith('.git')) repo = repo.slice(0, -4);
  if (!validRepo(owner, repo)) return null;

  let ref: string | null = null;
  if (parts.length >= 4) {
    // Decode so `feature%2Fx` and `feature/x` mean the same branch; a bad escape is rejected.
    let decoded: string;
    try {
      decoded = decodeURIComponent(parts.slice(3).join('/'));
    } catch {
      return null;
    }
    if (!REF_RE.test(decoded) || decoded.includes('..') || decoded.includes('//')) return null;
    ref = decoded;
  }
  return { owner, repo, ref };
}

export const interviewCreateSchema = z.object({
  repoUrl: z
    .string()
    .trim()
    .max(300)
    .refine((s) => parseGithubRepoUrl(s) !== null, 'Enter a public GitHub repository URL'),
  level: z.enum(['AUTO', 'INTERN', 'JUNIOR', 'MID', 'SENIOR']).default('AUTO'),
});
export type InterviewCreateInput = z.infer<typeof interviewCreateSchema>;

export interface InterviewEvidence {
  path: string;
  startLine: number;
  endLine: number;
  /** The server's copy of the real lines, never the model's. */
  snippet: string;
}
export interface InterviewQuestionView {
  position: number;
  category: InterviewCategory;
  difficulty: Difficulty;
  question: string;
  whyAsked: string;
  evidence: InterviewEvidence[];
  strongAnswer: string[];
  followUps: string[];
  redFlags: string[];
}
export interface InterviewSummary {
  id: string;
  owner: string;
  repo: string;
  commitSha: string | null;
  requestedLevel: InterviewLevel;
  apparentLevel: InterviewLevel | null;
  status: InterviewStatus;
  stage: InterviewStage;
  errorCode: InterviewErrorCode | null;
  questionCount: number;
  createdAt: string;
  finishedAt: string | null;
}
export interface InterviewProfileView {
  displayName: string;
  description: string | null;
  languages: { name: string; share: number }[];
  summary: string;
  focusAreas: string[];
  fileCount: number;
}
export interface InterviewDetail extends InterviewSummary {
  progress: { detail: string; waitingUntil: string | null } | null;
  profile: InterviewProfileView | null;
  questions: InterviewQuestionView[];
}
export interface InterviewListResponse {
  enabled: boolean;
  items: InterviewSummary[];
  quota: { used: number; limit: number; resetsAt: string | null };
  /** Groq's daily limit and the global caps. */
  capacity: { available: boolean; retryAt: string | null };
}

/** UI copy for a failed analysis, in one place. */
export const INTERVIEW_ERROR_MESSAGES: Record<InterviewErrorCode, string> = {
  REPO_NOT_FOUND: "We couldn't find that repository. Check the URL.",
  REPO_NOT_PUBLIC: 'Only public repositories are supported for now.',
  REPO_EMPTY: 'That repository has no commits yet.',
  REPO_TOO_LARGE: 'That repository is too large to analyse.',
  NO_SOURCE_FILES: "We didn't find source code to read (only docs, binaries or generated files).",
  GITHUB_RATE_LIMITED: 'GitHub is rate-limiting us. Try again in a few minutes.',
  GITHUB_UNAVAILABLE: "GitHub didn't respond. Try again shortly.",
  AI_BUSY: 'The AI is busy right now. Try again in a minute.',
  AI_CAPACITY: 'The AI has reached its limit for today. Try again later.',
  AI_UNAVAILABLE: 'The AI service is unavailable right now.',
  AI_REFUSED: 'The AI declined to analyse this repository.',
  TOO_FEW_QUESTIONS: "We couldn't write enough questions grounded in this code.",
  TIMEOUT: 'The analysis took too long and was stopped.',
  INTERNAL: 'Something went wrong.',
};
