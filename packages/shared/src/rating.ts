import type { Difficulty } from './judge.js';
import type { MatchEndReason } from './battle.js';

export type GameOutcome = 'WIN' | 'LOSS' | 'DRAW';

export interface RatingChange {
  userId: string;
  before: number;
  after: number;
  delta: number;
}

export interface LeaderboardEntry {
  /** Competition ranking: tied ratings share a rank (1, 2, 2, 4). */
  rank: number;
  userId: string;
  username: string;
  rating: number;
  /** RD above the provisional threshold: shown with a "?". */
  provisional: boolean;
  games: number;
}

export interface LeaderboardPage {
  total: number;
  offset: number;
  entries: LeaderboardEntry[];
  /** The viewer's own placement, or null if not ranked yet (needs a few rated games). */
  me: { rank: number; rating: number } | null;
}

export interface ProfileView {
  userId: string;
  username: string;
  joinedAt: number;
  rating: number;
  /** Effective RD right now, including inactivity. */
  rd: number;
  provisional: boolean;
  rank: number | null;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Rating after each rated game, oldest first (starts with the initial 1500). */
  history: { at: number; rating: number }[];
}

export interface MatchHistoryItem {
  matchId: string;
  at: number;
  outcome: GameOutcome;
  delta: number;
  ratingAfter: number;
  opponent: { username: string; rating: number };
  endReason: MatchEndReason;
  problem: { title: string; difficulty: Difficulty };
}

export interface MatchHistoryPage {
  items: MatchHistoryItem[];
  /** Pass back as `?cursor=` for the next page; null when there is none. */
  nextCursor: string | null;
}
