import { inflateRd } from './glicko2.js';

/**
 * Rating policy (decision.md D-047, D-049). Each game is rated on its own; idle time inflates RD at
 * one rating period per day.
 */
export const RATING_PERIOD_MS = 24 * 60 * 60 * 1000;
/** Leaderboard membership: at least one rated game and RD at most this (≈ 3 games in, ≈ 11 months idle out). */
export const LEADERBOARD_MAX_RD = 200;
/** Above this RD a rating is shown as provisional ("1523?"). */
export const PROVISIONAL_RD = 110;

/** RD right now: the stored value inflated for the time since it was last made exact. */
export const effectiveRd = (
  u: { ratingDev: number; volatility: number; rdUpdatedAt: Date },
  now = Date.now(),
) => inflateRd(u.ratingDev, u.volatility, (now - u.rdUpdatedAt.getTime()) / RATING_PERIOD_MS);
