import type { Difficulty } from '@thegrave/shared';
import type { BotPersona } from './roster.js';

/** One scripted submission: how long after the match starts, and how many tests it passes. */
export interface BotAttempt {
  atMs: number;
  passed: number;
  total: number;
}

/** What rating a problem of each difficulty is "worth", for working out how likely a bot is to crack it. */
export const DIFFICULTY_RATING: Record<Difficulty, number> = {
  EASY: 1100,
  MEDIUM: 1550,
  HARD: 2000,
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** The Elo expectation that a bot of this rating solves a problem of this difficulty at all. */
export function solveChance(botRating: number, difficulty: Difficulty): number {
  const p = 1 / (1 + 10 ** ((DIFFICULTY_RATING[difficulty] - botRating) / 400));
  return clamp(p, 0.04, 0.96);
}

/**
 * Scripts a bot's whole battle up front, so it is a handful of timed jobs rather than a live process.
 *
 * - Whether it solves the problem is a coin flip weighted by its rating against the difficulty: a 800 bot
 *   rarely cracks a Hard, a 2300 bot usually does.
 * - If it solves it, the time depends on the same gap (stronger = earlier) and the bot's pace, and the
 *   sloppier bots first send one or two wrong attempts.
 * - If it does not, it still makes one or two partial attempts, so the opponent has something to beat on a
 *   time-out and the scoreboard looks alive.
 *
 * Every time is inside the match, and only the last attempt of a solving bot passes every test.
 */
export function planBot(input: {
  bot: Pick<BotPersona, 'rating' | 'pace' | 'sloppiness'>;
  difficulty: Difficulty;
  durationMs: number;
  totalTests: number;
  rng: () => number;
}): BotAttempt[] {
  const { bot, difficulty, durationMs, totalTests: total, rng } = input;
  const between = (lo: number, hi: number) => lo + (hi - lo) * rng();
  const pSolve = solveChance(bot.rating, difficulty);
  const attempts: BotAttempt[] = [];

  if (rng() < pSolve) {
    const edge = (bot.rating - DIFFICULTY_RATING[difficulty]) / 400; // > 0: the problem is below its level
    const solveAt = clamp(
      durationMs * (0.55 - 0.22 * edge) * bot.pace * between(0.8, 1.2),
      Math.max(60_000, durationMs * 0.12),
      durationMs * 0.9,
    );
    const wrong = rng() < bot.sloppiness ? 1 + (rng() < 0.4 ? 1 : 0) : 0;
    for (let i = 0; i < wrong; i++) {
      attempts.push({
        atMs: between(solveAt * 0.25, solveAt * 0.9),
        passed: clamp(Math.floor(total * between(0.3, 0.9)), 0, Math.max(0, total - 1)),
        total,
      });
    }
    attempts.push({ atMs: solveAt, passed: total, total });
  } else {
    const tries = 1 + (rng() < 0.6 ? 1 : 0);
    for (let i = 0; i < tries; i++) {
      attempts.push({
        atMs: between(durationMs * 0.4, durationMs * 0.85),
        passed: clamp(
          Math.floor(total * clamp(pSolve * 0.9 + rng() * 0.25, 0.05, 0.85)),
          0,
          Math.max(0, total - 1),
        ),
        total,
      });
    }
  }
  return attempts.sort((a, b) => a.atMs - b.atMs).map((a) => ({ ...a, atMs: Math.round(a.atMs) }));
}

/** Picks the roster bot closest to a rating, varying between the two nearest so the same one isn't always faced. */
export function pickBotFor<T extends { rating: number }>(
  bots: readonly T[],
  rating: number,
  rng: () => number,
): T | null {
  const ranked = [...bots].sort(
    (a, b) => Math.abs(a.rating - rating) - Math.abs(b.rating - rating),
  );
  if (!ranked.length) return null;
  const [first, second] = ranked;
  // The runner-up only counts if it is nearly as close, so a 1500 player never gets a 2350 bot.
  const near = second && Math.abs(second.rating - rating) - Math.abs(first!.rating - rating) <= 150;
  return near && rng() < 0.35 ? second! : first!;
}
