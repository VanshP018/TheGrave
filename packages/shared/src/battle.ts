import type { Language, ProblemDetail, SubmissionStatus, Verdict } from './judge.js';
import type { ProjectDetail, ProjectLanguage } from './project.js';
import type { RatingChange } from './rating.js';

export type MatchStatus = 'PENDING' | 'ACTIVE' | 'FINISHED' | 'ABORTED';
/** DSA: one stdin/stdout problem. PROGRAMMING: a codebase to debug (decision.md D-067). */
export type MatchMode = 'DSA' | 'PROGRAMMING';
export const MATCH_MODES: MatchMode[] = ['DSA', 'PROGRAMMING'];
export type MatchEndReason =
  | 'SOLVED'
  | 'TIMEOUT'
  | 'FORFEIT'
  | 'ABANDONED'
  /** Both players agreed to a draw (decision.md D-068). */
  | 'AGREED'
  /** A player quit; the opponent wins. */
  | 'RESIGNED';

/** What a player may know about anyone in the match, including the opponent. Never code. */
export interface PlayerProgress {
  userId: string;
  username: string;
  avatarUrl: string | null;
  rating: number;
  /** A practice bot (shown with a BOT tag). */
  bot?: boolean;
  attempts: number;
  /** Judging still in progress. */
  pending: number;
  bestPassed: number;
  solved: boolean;
  connected: boolean;
  /** Set while disconnected: forfeit happens at this server time (epoch ms) unless they return. */
  graceEndsAt: number | null;
}

export interface MatchResult {
  status: 'FINISHED' | 'ABORTED';
  /** null with status FINISHED = draw. */
  winnerId: string | null;
  endReason: MatchEndReason;
  /** Present for rated (FINISHED) matches. */
  ratingChanges?: RatingChange[];
}

export interface MySubmission {
  id: string;
  /** For PROGRAMMING matches, the project's language. */
  language: Language | ProjectLanguage;
  status: SubmissionStatus;
  verdict: Verdict | null;
  testsPassed: number | null;
  testsTotal: number | null;
  createdAt: number;
}

export interface BattleView {
  id: string;
  status: MatchStatus;
  /** False for private-room matches, which never change ratings. */
  rated: boolean;
  /** Server epoch ms; render countdowns with the server clock offset (see `time:sync`). */
  startsAt: number;
  endsAt: number;
  serverNow: number;
  mode: MatchMode;
  /** DSA matches: hidden until the match starts. */
  problem: ProblemDetail | null;
  /** PROGRAMMING matches: the codebase, hidden until the match starts. */
  project: ProjectDetail | null;
  totalTests: number | null;
  players: PlayerProgress[];
  mySubmissions: MySubmission[];
  submitCooldownMs: number;
  /** Who has a draw offer open right now, if anyone (decision.md D-068). */
  drawOfferedBy: string | null;
  result: MatchResult | null;
}
