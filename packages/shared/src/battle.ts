import type { Language, ProblemDetail, SubmissionStatus, Verdict } from './judge.js';
import type { RatingChange } from './rating.js';

export type MatchStatus = 'PENDING' | 'ACTIVE' | 'FINISHED' | 'ABORTED';
export type MatchEndReason = 'SOLVED' | 'TIMEOUT' | 'FORFEIT' | 'ABANDONED';

/** What a player may know about anyone in the match, including the opponent. Never code. */
export interface PlayerProgress {
  userId: string;
  username: string;
  rating: number;
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
  language: Language;
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
  /** Hidden until the match starts. */
  problem: ProblemDetail | null;
  totalTests: number | null;
  players: PlayerProgress[];
  mySubmissions: MySubmission[];
  submitCooldownMs: number;
  result: MatchResult | null;
}
