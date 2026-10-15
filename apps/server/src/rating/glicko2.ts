/**
 * Glicko-2, implemented step by step from Glickman, "Example of the Glicko-2 system" (2013),
 * http://www.glicko.net/glicko/glicko2.pdf. Pure functions, no I/O.
 */

/** Glicko-2 ↔ Glicko scale factor (400 / ln 10). */
export const SCALE = 173.7178;
export const DEFAULT_RATING = 1500;
export const MAX_RD = 350;
/** System constant τ: how much volatility may change per period. Glickman suggests 0.3–1.2. */
export const TAU = 0.5;
const EPSILON = 0.000001;

export interface Rating {
  rating: number;
  rd: number;
  volatility: number;
}

/** score: 1 win, 0.5 draw, 0 loss, from the rated player's point of view. */
export interface GameResult {
  opponent: Pick<Rating, 'rating' | 'rd'>;
  score: 0 | 0.5 | 1;
}

/** Step 3: estimated variance of the rating based on game outcomes only. */
export const varianceV = (gs: number[], es: number[]) =>
  1 / gs.reduce((sum, gj, j) => sum + gj * gj * es[j]! * (1 - es[j]!), 0);
/** Step 4: estimated improvement Δ. */
export const improvementDelta = (v: number, gs: number[], es: number[], scores: number[]) =>
  v * gs.reduce((sum, gj, j) => sum + gj * (scores[j]! - es[j]!), 0);

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** Intermediate quantities of one update, named as in the paper (for tests and debugging). */
export interface RatingTrace {
  mu: number;
  phi: number;
  g: number[];
  E: number[];
  v: number;
  delta: number;
  sigmaNew: number;
  phiStar: number;
  phiNew: number;
  muNew: number;
}

/**
 * One rating period. `periodFraction` scales the step-6 pre-period RD increase: 1 is the paper's
 * algorithm; we pass 0 because idle time is applied separately via `inflateRd` (decision.md D-047).
 */
export function rate(
  player: Rating,
  games: GameResult[],
  opts: { tau?: number; periodFraction?: number } = {},
): Rating {
  return rateWithTrace(player, games, opts).result;
}

export function rateWithTrace(
  player: Rating,
  games: GameResult[],
  opts: { tau?: number; periodFraction?: number } = {},
): { result: Rating; trace: RatingTrace | null } {
  const tau = opts.tau ?? TAU;
  const periodFraction = opts.periodFraction ?? 1;

  // Step 2: convert to the Glicko-2 scale.
  const mu = (player.rating - DEFAULT_RATING) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.volatility;

  // A player who did not compete only gets the RD increase (step 6 alone).
  if (games.length === 0) {
    const rd = Math.min(MAX_RD, Math.sqrt(phi * phi + periodFraction * sigma * sigma) * SCALE);
    return { result: { ...player, rd }, trace: null };
  }

  const opp = games.map(({ opponent, score }) => {
    const muJ = (opponent.rating - DEFAULT_RATING) / SCALE;
    const phiJ = opponent.rd / SCALE;
    return { g: g(phiJ), e: E(mu, muJ, phiJ), score };
  });

  // Step 3: estimated variance v. Step 4: estimated improvement Δ.
  const gs = opp.map((o) => o.g);
  const es = opp.map((o) => o.e);
  const v = varianceV(gs, es);
  const delta = improvementDelta(
    v,
    gs,
    es,
    opp.map((o) => o.score),
  );

  // Step 5: new volatility σ' via the Illinois algorithm.
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (
      (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) -
      (x - a) / (tau * tau)
    );
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  const sigmaNew = Math.exp(A / 2);

  // Step 6: pre-rating-period value φ*. Step 7: new φ' and μ'.
  const phiStar = Math.sqrt(phi * phi + periodFraction * sigmaNew * sigmaNew);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * opp.reduce((sum, o) => sum + o.g * (o.score - o.e), 0);

  // Step 8: back to the Glicko scale.
  return {
    result: {
      rating: muNew * SCALE + DEFAULT_RATING,
      rd: Math.min(MAX_RD, phiNew * SCALE),
      volatility: sigmaNew,
    },
    trace: {
      mu,
      phi,
      g: opp.map((o) => o.g),
      E: opp.map((o) => o.e),
      v,
      delta,
      sigmaNew,
      phiStar,
      phiNew,
      muNew,
    },
  };
}

/**
 * RD after `periods` idle rating periods: φ = √(φ² + σ²·t), capped at 350.
 * Additive in t, so inflating in several steps equals inflating once (lets the periodic job and the
 * lazy calculation at match time agree exactly).
 */
export function inflateRd(rd: number, volatility: number, periods: number): number {
  if (periods <= 0) return rd;
  const phi = rd / SCALE;
  return Math.min(MAX_RD, Math.sqrt(phi * phi + volatility * volatility * periods) * SCALE);
}
