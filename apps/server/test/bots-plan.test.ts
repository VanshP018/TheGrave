import { describe, expect, it } from 'vitest';
import { pickBotFor, planBot, solveChance } from '../src/bots/plan.js';
import { BOTS } from '../src/bots/roster.js';

// Practice bots: how likely they are to solve something, how their battle is scripted, and which one a player gets.
const seeded = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const MIN = 60_000;

describe('roster', () => {
  it('is a ladder from beginner to expert with unique names', () => {
    expect(BOTS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(BOTS.map((b) => b.username)).size).toBe(BOTS.length);
    const ratings = BOTS.map((b) => b.rating);
    expect(Math.min(...ratings)).toBeLessThanOrEqual(900);
    expect(Math.max(...ratings)).toBeGreaterThanOrEqual(2300);
    expect(ratings).toEqual([...ratings].sort((a, b) => a - b));
  });
});

describe('solveChance', () => {
  it('rises with rating and falls with difficulty', () => {
    expect(solveChance(800, 'EASY')).toBeLessThan(solveChance(1500, 'EASY'));
    expect(solveChance(1500, 'EASY')).toBeGreaterThan(solveChance(1500, 'MEDIUM'));
    expect(solveChance(1500, 'MEDIUM')).toBeGreaterThan(solveChance(1500, 'HARD'));
    expect(solveChance(800, 'HARD')).toBeLessThan(0.1);
    expect(solveChance(2350, 'HARD')).toBeGreaterThan(0.8);
  });
  it('never reaches a certainty either way', () => {
    expect(solveChance(100, 'HARD')).toBeGreaterThan(0);
    expect(solveChance(4000, 'EASY')).toBeLessThan(1);
  });
});

describe('planBot', () => {
  const run = (rating: number, difficulty: 'EASY' | 'MEDIUM' | 'HARD', seed: number, pace = 1) =>
    planBot({
      bot: { rating, pace, sloppiness: 0.4 },
      difficulty,
      durationMs: 25 * MIN,
      totalTests: 10,
      rng: seeded(seed),
    });

  it('keeps every attempt inside the match, in order, and only the last can be a full pass', () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const rating of [800, 1500, 2350]) {
        const plan = run(rating, 'MEDIUM', seed);
        expect(plan.length).toBeGreaterThanOrEqual(1);
        for (const a of plan) {
          expect(a.atMs).toBeGreaterThan(0);
          expect(a.atMs).toBeLessThan(25 * MIN);
          expect(a.total).toBe(10);
          expect(a.passed).toBeGreaterThanOrEqual(0);
          expect(a.passed).toBeLessThanOrEqual(10);
        }
        expect(plan.map((a) => a.atMs)).toEqual([...plan.map((a) => a.atMs)].sort((x, y) => x - y));
        const full = plan.filter((a) => a.passed === a.total);
        expect(full.length).toBeLessThanOrEqual(1);
        if (full.length) expect(plan.at(-1)).toBe(full[0]);
      }
    }
  });

  it('solves far more often, and sooner, the stronger the bot is', () => {
    const stats = (rating: number) => {
      let solved = 0;
      let totalAt = 0;
      const n = 400;
      for (let seed = 1; seed <= n; seed++) {
        const full = run(rating, 'MEDIUM', seed).find((a) => a.passed === a.total);
        if (full) {
          solved++;
          totalAt += full.atMs;
        }
      }
      return { rate: solved / n, meanAt: solved ? totalAt / solved : Infinity };
    };
    const weak = stats(800);
    const mid = stats(1550);
    const strong = stats(2350);
    expect(weak.rate).toBeLessThan(0.2);
    expect(mid.rate).toBeGreaterThan(0.35);
    expect(mid.rate).toBeLessThan(0.7);
    expect(strong.rate).toBeGreaterThan(0.85);
    expect(strong.meanAt).toBeLessThan(mid.meanAt);
  });

  it('a bot that does not solve still makes partial attempts', () => {
    // 0.99 on the first roll: the bot fails to solve a hard problem
    const plan = planBot({
      bot: { rating: 800, pace: 1, sloppiness: 0.5 },
      difficulty: 'HARD',
      durationMs: 40 * MIN,
      totalTests: 10,
      rng: () => 0.99,
    });
    expect(plan.length).toBeGreaterThanOrEqual(1);
    expect(plan.every((a) => a.passed < a.total)).toBe(true);
  });
});

describe('pickBotFor', () => {
  it('gives the closest bot, and never one far from the player', () => {
    for (const rating of [500, 900, 1500, 1730, 2000, 3000]) {
      const closest = Math.min(...BOTS.map((b) => Math.abs(b.rating - rating)));
      for (let seed = 1; seed <= 50; seed++) {
        const bot = pickBotFor(BOTS, rating, seeded(seed))!;
        expect(Math.abs(bot.rating - rating)).toBeLessThanOrEqual(closest + 150);
      }
    }
  });
  it('can vary between near-equal bots but is not random across the ladder', () => {
    const picked = new Set<string>();
    for (let seed = 1; seed <= 200; seed++)
      picked.add(pickBotFor(BOTS, 1550, seeded(seed))!.username);
    expect(picked.size).toBeGreaterThanOrEqual(2);
    expect(picked.size).toBeLessThanOrEqual(3);
  });
  it('returns null with no bots', () => {
    expect(pickBotFor([], 1500, Math.random)).toBeNull();
  });
});
