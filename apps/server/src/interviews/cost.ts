import type { LlmUsage } from './llm.js';

/** USD per million tokens (== micro-USD per token), from console.groq.com/docs/models and prompt-caching. */
interface Price {
  input: number;
  cachedInput: number;
  output: number;
}

export const PRICES: Record<string, Price> = {
  'openai/gpt-oss-120b': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  'openai/gpt-oss-20b': { input: 0.075, cachedInput: 0.0375, output: 0.3 },
  // Preview model; Groq publishes no cached price, so the usual 50% cached discount is assumed.
  'qwen/qwen3.8-27b': { input: 0.8, cachedInput: 0.4, output: 4.0 },
};

export function isPricedModel(model: string): boolean {
  return model in PRICES;
}

/**
 * Cost of one call in micro-USD (1e-6 USD). Cached input is priced separately; completion tokens already
 * include reasoning tokens. An unknown model costs 0 here, so callers should log it via isPricedModel.
 */
export function costMicroUsd(usage: LlmUsage): number {
  const p = PRICES[usage.model];
  if (!p) return 0;
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  return Math.round(
    (usage.inputTokens - cached) * p.input + cached * p.cachedInput + usage.outputTokens * p.output,
  );
}

export function totalCostMicroUsd(usages: LlmUsage[]): number {
  return usages.reduce((n, u) => n + costMicroUsd(u), 0);
}
