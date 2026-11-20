import type { Difficulty } from './judge.js';
import type { LeaderboardScope } from './rating.js';

/**
 * Points for solving a problem or a programming challenge for the first time: the harder, the more.
 * Each problem counts once, however many times it is solved again.
 */
export const DIFFICULTY_POINTS: Record<Difficulty, number> = { EASY: 1, MEDIUM: 3, HARD: 5 };

export type SolveKind = 'DSA' | 'PROGRAMMING';

/** How many problems of each difficulty were solved. */
export interface SolvedBreakdown {
  easy: number;
  medium: number;
  hard: number;
}

/** One calendar day (UTC) with at least one first-time solve. */
export interface ActivityDay {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  dsaSolved: number;
  dsaPoints: number;
  programmingSolved: number;
  programmingPoints: number;
}

/** Everything the profile's "problems solved" section needs (heat map, totals, streaks, standing). */
export interface ActivityView {
  points: number;
  solved: number;
  dsa: SolvedBreakdown;
  programming: SolvedBreakdown;
  /** Days with activity inside the heat map window (about the last year), oldest first. */
  days: ActivityDay[];
  /** First and last day of the heat map window, `YYYY-MM-DD` (UTC). */
  from: string;
  to: string;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  /** Place by points among everyone, and among the player's school/college; null if no points yet. */
  rank: { global: number | null; university: number | null };
}

export interface PointsLeaderboardEntry {
  /** Competition ranking: tied points share a rank (1, 2, 2, 4). */
  rank: number;
  userId: string;
  username: string;
  institution: string | null;
  points: number;
  solved: number;
  dsa: number;
  programming: number;
}

export interface PointsLeaderboardPage {
  scope: LeaderboardScope;
  /** The viewer's school/college, which the `university` scope is limited to; null if they have none. */
  institution: string | null;
  total: number;
  offset: number;
  entries: PointsLeaderboardEntry[];
  /** The viewer's own placement, or null if they have not solved anything yet. */
  me: { rank: number; points: number } | null;
}
