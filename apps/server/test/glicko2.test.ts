import { describe, expect, it } from 'vitest';
import {
  improvementDelta,
  inflateRd,
  MAX_RD,
  rate,
  rateWithTrace,
  varianceV,
  type Rating,
} from '../src/rating/glicko2.js';

describe("Glicko-2: Glickman's worked example (glicko2.pdf, 'Example calculation')", () => {
  // Player 1500/200/0.06 plays three games in one rating period, τ = 0.5.
  // The paper prints every intermediate value rounded, *and carries the rounded values into the next step*.
  // So: inputs to each step match at printed precision, and the paper's own arithmetic on its rounded
  // values reproduces its printed results exactly with our formulas. Full precision drifts by < 0.1 %.
  const player: Rating = { rating: 1500, rd: 200, volatility: 0.06 };
  const games = [
    { opponent: { rating: 1400, rd: 30 }, score: 1 as const },
    { opponent: { rating: 1550, rd: 100 }, score: 0 as const },
    { opponent: { rating: 1700, rd: 300 }, score: 0 as const },
  ];
  const { result, trace } = rateWithTrace(player, games, { tau: 0.5 });
  const t = trace!;
  const near = (actual: number, expected: number, places: number) =>
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.5 * 10 ** -places + 1e-12);

  it('step 2: μ = 0, φ = 1.1513', () => {
    near(t.mu, 0, 4);
    near(t.phi, 1.1513, 4);
  });
  it('step 3: g(φj) = 0.9955, 0.9531, 0.7242 and E = 0.639, 0.432, 0.303', () => {
    [0.9955, 0.9531, 0.7242].forEach((x, i) => near(t.g[i]!, x, 4));
    [0.639, 0.432, 0.303].forEach((x, i) => near(t.E[i]!, x, 3));
  });
  it('steps 3–4: v = 1.7785, Δ = −0.4834 from the paper’s rounded g and E', () => {
    const gs = [0.9955, 0.9531, 0.7242];
    const es = [0.639, 0.432, 0.303];
    const v = varianceV(gs, es);
    near(v, 1.7785, 4);
    near(improvementDelta(v, gs, es, [1, 0, 0]), -0.4834, 4);
    // Full precision (1.77898, −0.48393) differs only by that rounding.
    expect(Math.abs(t.v - 1.7785) / 1.7785).toBeLessThan(0.001);
    expect(Math.abs(t.delta - -0.4834) / 0.4834).toBeLessThan(0.002);
  });
  it("step 5: σ' = 0.05999 (Illinois iteration)", () => {
    // The paper truncates: our full-precision value is 0.0599960.
    expect(t.sigmaNew).toBeGreaterThanOrEqual(0.05999);
    expect(t.sigmaNew).toBeLessThan(0.06);
  });
  it("step 6–7: φ* = 1.152862, φ' = 0.8722, μ' = −0.2069", () => {
    // φ* from the paper's rounded φ = 1.1513 and σ' = 0.05999, then ours at full precision.
    near(Math.sqrt(1.1513 ** 2 + 0.05999 ** 2), 1.152862, 6);
    near(t.phiStar, 1.152862, 4);
    near(t.phiNew, 0.8722, 4);
    near(t.muNew, -0.2069, 4);
  });
  it("step 8: r' = 1464.06, RD' = 151.52 (within the paper's rounding)", () => {
    // The paper converts its *rounded* μ' (−0.2069·173.7178 + 1500 = 1464.06); unrounded gives 1464.0507.
    expect(Math.abs(result.rating - 1464.06)).toBeLessThan(0.01);
    near(result.rd, 151.52, 2);
  });
  it('is unaffected by game order', () => {
    expect(rate(player, [...games].reverse(), { tau: 0.5 }).rating).toBeCloseTo(result.rating, 10);
  });
});

describe('Glicko-2 properties', () => {
  const fresh: Rating = { rating: 1500, rd: 350, volatility: 0.06 };
  const vet: Rating = { rating: 1500, rd: 50, volatility: 0.06 };

  it('winner gains, loser loses, draw between equals changes nothing', () => {
    expect(
      rate(fresh, [{ opponent: fresh, score: 1 }], { periodFraction: 0 }).rating,
    ).toBeGreaterThan(1500);
    expect(rate(fresh, [{ opponent: fresh, score: 0 }], { periodFraction: 0 }).rating).toBeLessThan(
      1500,
    );
    expect(
      rate(fresh, [{ opponent: fresh, score: 0.5 }], { periodFraction: 0 }).rating,
    ).toBeCloseTo(1500, 8);
  });

  it('new players move fast, veterans move slowly (the reason for Glicko over Elo, D-010)', () => {
    const newGain = rate(fresh, [{ opponent: vet, score: 1 }], { periodFraction: 0 }).rating - 1500;
    const vetGain = rate(vet, [{ opponent: fresh, score: 1 }], { periodFraction: 0 }).rating - 1500;
    expect(newGain).toBeGreaterThan(150);
    expect(vetGain).toBeLessThan(10);
  });

  it('an upset moves ratings more than an expected result', () => {
    const strong = { rating: 1900, rd: 80, volatility: 0.06 };
    const weak = { rating: 1500, rd: 80, volatility: 0.06 };
    const expected =
      rate(strong, [{ opponent: weak, score: 1 }], { periodFraction: 0 }).rating - 1900;
    const upset = 1900 - rate(strong, [{ opponent: weak, score: 0 }], { periodFraction: 0 }).rating;
    expect(upset).toBeGreaterThan(expected * 3);
  });

  it('playing shrinks RD', () => {
    expect(rate(fresh, [{ opponent: vet, score: 1 }], { periodFraction: 0 }).rd).toBeLessThan(350);
  });

  it('a period without games only increases RD (step 6)', () => {
    const idle = rate(vet, []);
    expect(idle.rating).toBe(1500);
    expect(idle.rd).toBeCloseTo(inflateRd(50, 0.06, 1), 10);
  });
});

describe('inflateRd (inactivity decay)', () => {
  it('grows with idle time and caps at 350', () => {
    expect(inflateRd(50, 0.06, 0)).toBe(50);
    expect(inflateRd(50, 0.06, 10)).toBeGreaterThan(50);
    expect(inflateRd(50, 0.06, 1e6)).toBe(MAX_RD);
  });

  it('is additive in time: many small steps equal one big step', () => {
    let rd = 60;
    for (let i = 0; i < 30; i++) rd = inflateRd(rd, 0.06, 1);
    expect(rd).toBeCloseTo(inflateRd(60, 0.06, 30), 10);
    expect(inflateRd(inflateRd(60, 0.06, 2.5), 0.06, 7.5)).toBeCloseTo(inflateRd(60, 0.06, 10), 10);
  });
});
