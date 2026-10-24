import type { Difficulty } from './judge.js';
import type { MatchEndReason } from './battle.js';
import type { SocialLinks } from './profile.js';

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
  /** The player's school or college (decision.md D-079); null for accounts created before it was asked. */
  institution: string | null;
}

/** Whose ranking: everyone, or only players from the viewer's own school/college. */
export type LeaderboardScope = 'global' | 'university';

export interface LeaderboardPage {
  /** The scope this page was computed for. */
  scope: LeaderboardScope;
  /** The viewer's school/college, which the `university` scope is limited to; null if they have none. */
  institution: string | null;
  total: number;
  offset: number;
  entries: LeaderboardEntry[];
  /** The viewer's own placement, or null if not ranked yet (needs a few rated games). */
  me: { rank: number; rating: number } | null;
}

export interface ProfileView {
  userId: string;
  username: string;
  /** Public profile extras (decision.md D-071). */
  bio: string | null;
  /** School / college (decision.md D-076). */
  institution: string | null;
  links: SocialLinks;
  avatarUrl: string | null;
  /** Highest rating reached, from the history. */
  peakRating: number;
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
