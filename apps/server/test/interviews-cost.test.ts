import { describe, expect, it } from 'vitest';
import { costMicroUsd, isPricedModel, totalCostMicroUsd } from '../src/interviews/cost.js';

const usage = (model: string, i: number, o: number, c = 0) => ({
  model,
  inputTokens: i,
  outputTokens: o,
  cachedInputTokens: c,
  reasoningTokens: null,
});

describe('costMicroUsd', () => {
  it('prices gpt-oss-120b input and output', () => {
    // 10k in * 0.15 + 2k out * 0.60 = 1500 + 1200
    expect(costMicroUsd(usage('openai/gpt-oss-120b', 10_000, 2000))).toBe(2700);
  });

  it('prices cached input at its own rate', () => {
    // 6k fresh * 0.15 + 4k cached * 0.075 + 1k out * 0.60 = 900 + 300 + 600
    expect(costMicroUsd(usage('openai/gpt-oss-120b', 10_000, 1000, 4000))).toBe(1800);
  });

  it('prices gpt-oss-20b', () => {
    expect(costMicroUsd(usage('openai/gpt-oss-20b', 8000, 3000))).toBe(1500); // 600 + 900
  });

  it('costs nothing for an unknown model and sums a list', () => {
    expect(isPricedModel('fake')).toBe(false);
    expect(costMicroUsd(usage('fake', 1000, 1000))).toBe(0);
    expect(totalCostMicroUsd([usage('openai/gpt-oss-20b', 8000, 3000), usage('fake', 5, 5)])).toBe(
      1500,
    );
  });
});
