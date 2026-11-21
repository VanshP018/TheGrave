import { describe, expect, it } from 'vitest';
import { pickBotFor, planBot, solveChance } from '../src/bots/plan.js';
import { BOTS, traitsFor } from '../src/bots/roster.js';

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
  it('is a dense ladder from beginner to expert, with no big gaps', () => {
    expect(BOTS.length).toBeGreaterThanOrEqual(35);
    const ratings = BOTS.map((b) => b.rating);
    expect(ratings).toEqual([...ratings].sort((a, b) => a - b));
    expect(Math.min(...ratings)).toBeLessThanOrEqual(750);
    expect(Math.max(...ratings)).toBeGreaterThanOrEqual(2450);
    for (let i = 1; i < ratings.length; i++)
      expect(
        ratings[i]! - ratings[i - 1]!,
        `${ratings[i - 1]} -> ${ratings[i]}`,
      ).toBeLessThanOrEqual(120);
    // most players sit near 1500, so that is where the rungs are closest
    const near = ratings.filter((r) => r >= 1300 && r <= 1700).length;
    expect(near).toBeGreaterThanOrEqual(10);
  });

  it('has unique, valid usernames that read like a person chose them', () => {
    const names = BOTS.map((b) => b.username);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    for (const n of names) {
      expect(n, n).toMatch(/^[a-zA-Z0-9_]{3,20}$/); // the same rule a player registers with
      expect(n.toLowerCase(), n).not.toContain('bot');
    }
  });

  it('keeps the first roster as legacy names, so those accounts are renamed rather than replaced', () => {
    const legacy = BOTS.filter((b) => b.legacy).map((b) => b.legacy);
    expect(legacy.sort()).toEqual(
      [
        'ArrayAnt',
        'BitBea',
        'DPDiya',
        'FlowFinn',
        'GraphGio',
        'HeapHana',
        'LoopLarry',
        'NullNova',
        'QueueQuinn',
        'SegSasha',
        'StackSam',
        'TreeTara',
      ].sort(),
    );
    const byLegacy = Object.fromEntries(
      BOTS.filter((b) => b.legacy).map((b) => [b.legacy, b.rating]),
    );
    expect(byLegacy).toMatchObject({ ArrayAnt: 800, TreeTara: 1500, NullNova: 2350 }); // ratings unchanged
  });

  it('mixes playing styles, and stronger players are quicker and less sloppy', () => {
    expect(new Set(BOTS.map((b) => b.style)).size).toBe(4);
    expect(traitsFor(2400).pace).toBeLessThan(traitsFor(800).pace);
    expect(traitsFor(2400).sloppiness).toBeLessThan(traitsFor(800).sloppiness);
    expect(traitsFor(1500, 'speedy').pace).toBeLessThan(traitsFor(1500, 'careful').pace);
    expect(traitsFor(1500, 'careful').sloppiness).toBeLessThan(
      traitsFor(1500, 'speedy').sloppiness,
    );
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

describe('planBot quality', () => {
  const base = { difficulty: 'MEDIUM' as const, durationMs: 25 * MIN, totalTests: 10 };

  it('wrong attempts creep upwards and always pass the sample tests', () => {
    let withWrong = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const plan = planBot({
        ...base,
        bot: { rating: 1700, pace: 1, sloppiness: 0.8, style: 'grinder' },
        minPassed: 2,
        rng: seeded(seed),
      });
      const passes = plan.map((a) => a.passed);
      expect(passes).toEqual([...passes].sort((a, b) => a - b)); // never worse than the last try
      for (const a of plan) expect(a.passed).toBeGreaterThanOrEqual(2);
      if (plan.length > 1) withWrong++;
    }
    expect(withWrong).toBeGreaterThan(150); // a sloppy grinder usually gets a few wrong first
  });

  it('solve times vary like a person is', () => {
    const times: number[] = [];
    for (let seed = 1; seed <= 600; seed++) {
      const full = planBot({
        ...base,
        bot: { rating: 1650, pace: 1, sloppiness: 0.2 },
        rng: seeded(seed),
      }).find((a) => a.passed === a.total);
      if (full) times.push(full.atMs);
    }
    expect(times.length).toBeGreaterThan(200);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const sd = Math.sqrt(times.reduce((a, t) => a + (t - mean) ** 2, 0) / times.length);
    expect(sd / mean).toBeGreaterThan(0.15); // not a fixed time with a little noise
    expect(Math.min(...times)).toBeGreaterThanOrEqual(40_000); // nobody solves a Medium in seconds
    expect(Math.max(...times)).toBeLessThanOrEqual(25 * MIN * 0.92);
  });

  it('styles behave differently: speedy bots submit sooner, grinders try more often', () => {
    const avg = (
      style: 'speedy' | 'careful' | 'grinder',
      pick: (a: ReturnType<typeof planBot>) => number,
    ) => {
      let sum = 0;
      for (let seed = 1; seed <= 500; seed++)
        sum += pick(
          planBot({
            ...base,
            bot: { ...traitsFor(1400, style), rating: 1400, style },
            rng: seeded(seed),
          }),
        );
      return sum / 500;
    };
    const firstAt = (a: ReturnType<typeof planBot>) => a[0]!.atMs;
    expect(avg('speedy', firstAt)).toBeLessThan(avg('careful', firstAt));
    const tries = (a: ReturnType<typeof planBot>) => a.length;
    expect(avg('grinder', tries)).toBeGreaterThan(avg('careful', tries));
  });

  it('a good or a bad day moves the same bot around a little', () => {
    const rates = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const plan = planBot({
        ...base,
        bot: { rating: 1550, pace: 1, sloppiness: 0 },
        rng: seeded(seed),
      });
      rates.add(plan.at(-1)!.atMs);
    }
    expect(rates.size).toBeGreaterThan(20);
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
  it('skips bots the player just faced when others are nearly as close', () => {
    const bots = BOTS.map((b, i) => ({ ...b, id: `bot${i}` }));
    for (const rating of [900, 1500, 1800, 2300]) {
      for (let seed = 1; seed <= 100; seed++) {
        const first = pickBotFor(bots, rating, seeded(seed))!;
        const second = pickBotFor(bots, rating, seeded(seed), new Set([first.id]))!;
        expect(second.id).not.toBe(first.id);
        expect(Math.abs(second.rating - rating)).toBeLessThanOrEqual(
          Math.min(...bots.map((b) => Math.abs(b.rating - rating))) + 150,
        );
      }
    }
  });
  it('still returns a bot when every close one was avoided', () => {
    const only = [{ id: 'a', rating: 1500 }];
    expect(pickBotFor(only, 1500, Math.random, new Set(['a']))!.id).toBe('a');
  });
  it('returns null with no bots', () => {
    expect(pickBotFor([], 1500, Math.random)).toBeNull();
  });
});
