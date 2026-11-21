import type { Difficulty } from '@thegrave/shared';
import type { BotPersona, BotStyle } from './roster.js';

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

/** A standard normal draw from two uniform ones (Box-Muller), so timings have a realistic long tail. */
const normal = (rng: () => number) => {
  const u1 = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
};

/**
 * Scripts a bot's whole battle up front, so it is a handful of timed jobs rather than a live process.
 *
 * - It has a good or a bad day: its rating is nudged by up to +-75 for this match only.
 * - Whether it solves the problem is a coin flip weighted by that rating against the difficulty: an 800 bot
 *   rarely cracks a Hard, a 2300 bot usually does.
 * - If it solves it, the time is log-normal around a median that shrinks as the bot gets stronger relative to
 *   the problem (so most solves land near the median, with the odd very quick or very slow one). Its style
 *   decides how many wrong submissions come first; those get steadily closer to passing and, like a person's,
 *   always pass the sample tests (`minPassed`).
 * - If it does not, it still makes a few partial attempts that creep upwards, so the opponent has something to
 *   beat on a time-out and the scoreboard looks alive. Grinders try more often.
 *
 * Every time is inside the match, and only the last attempt of a solving bot passes every test.
 */
export function planBot(input: {
  bot: Pick<BotPersona, 'rating' | 'pace' | 'sloppiness'> & { style?: BotStyle };
  difficulty: Difficulty;
  durationMs: number;
  totalTests: number;
  /** Tests every real attempt passes (the samples a player can see). */
  minPassed?: number;
  rng: () => number;
}): BotAttempt[] {
  const { bot, difficulty, durationMs, totalTests: total, rng } = input;
  const style = bot.style ?? 'steady';
  const floor = Math.min(input.minPassed ?? 0, Math.max(0, total - 1));
  const between = (lo: number, hi: number) => lo + (hi - lo) * rng();
  const partial = (frac: number) => clamp(Math.round(total * frac), floor, Math.max(0, total - 1));

  const form = (rng() - 0.5) * 150;
  const rating = bot.rating + form;
  const pSolve = solveChance(rating, difficulty);
  const attempts: BotAttempt[] = [];

  if (rng() < pSolve) {
    const edge = (rating - DIFFICULTY_RATING[difficulty]) / 400; // > 0: the problem is below its level
    const median = durationMs * clamp(0.5 - 0.2 * edge, 0.12, 0.8) * bot.pace;
    const solveAt = clamp(
      median * Math.exp(0.32 * normal(rng)),
      Math.max(40_000, durationMs * 0.06),
      durationMs * 0.92,
    );
    const chance = clamp(bot.sloppiness * (style === 'speedy' ? 1.1 : 1), 0, 0.85);
    const wrong =
      rng() < chance ? 1 + (rng() < 0.4 ? 1 : 0) + (style === 'grinder' && rng() < 0.5 ? 1 : 0) : 0;
    const times = Array.from({ length: wrong }, () => between(solveAt * 0.25, solveAt * 0.92)).sort(
      (a, b) => a - b,
    );
    let best = floor;
    times.forEach((atMs, i) => {
      // closer to passing with each try, never worse than the last one
      best = Math.max(best, partial(between(0.35, 0.55) + 0.4 * ((i + 1) / (wrong + 1))));
      attempts.push({ atMs, passed: best, total });
    });
    attempts.push({ atMs: solveAt, passed: total, total });
  } else {
    const tries = 1 + (rng() < 0.6 ? 1 : 0) + (style === 'grinder' ? 1 + (rng() < 0.5 ? 1 : 0) : 0);
    const top = clamp(pSolve * 0.9 + rng() * 0.25, 0.05, 0.85);
    const times = Array.from({ length: tries }, () =>
      between(durationMs * 0.35, durationMs * 0.88),
    ).sort((a, b) => a - b);
    let best = 0;
    times.forEach((atMs, i) => {
      best = Math.max(best, partial(top * (0.6 + 0.4 * ((i + 1) / tries))));
      attempts.push({ atMs, passed: best, total });
    });
  }
  return attempts.sort((a, b) => a.atMs - b.atMs).map((a) => ({ ...a, atMs: Math.round(a.atMs) }));
}

/**
 * Picks the roster bot for a player: one of the three closest ratings, nearer ones more likely, and never one
 * more than 150 further than the closest. Bots the player met recently are skipped when there is an
 * alternative, so the same name does not turn up twice in a row.
 */
export function pickBotFor<T extends { id?: string; rating: number }>(
  bots: readonly T[],
  rating: number,
  rng: () => number,
  avoid: ReadonlySet<string> = new Set(),
): T | null {
  const dist = (b: T) => Math.abs(b.rating - rating);
  const ranked = [...bots].sort((a, b) => dist(a) - dist(b));
  const closest = ranked[0];
  if (!closest) return null;
  let pool = ranked.filter((b) => dist(b) - dist(closest) <= 150).slice(0, 3);
  const fresh = pool.filter((b) => !(b.id && avoid.has(b.id)));
  if (fresh.length) pool = fresh;
  const weights = [0.6, 0.25, 0.15].slice(0, pool.length);
  let roll = rng() * weights.reduce((s, w) => s + w, 0);
  for (const [i, w] of weights.entries()) {
    roll -= w;
    if (roll <= 0) return pool[i]!;
  }
  return pool[0]!;
}
