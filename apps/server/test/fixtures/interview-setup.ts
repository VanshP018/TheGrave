import { TIER_PROFILES, type GroqTier } from '../../src/interviews/budget.js';
import { packFiles, shardPack } from '../../src/interviews/pack.js';
import { profileRepo } from '../../src/interviews/profile.js';
import { MemoryRepoSource } from '../../src/interviews/source.js';
import { buildSourceIndex } from '../../src/interviews/verify.js';
import type { FixtureRepo } from './interview-repos.js';

export const signal = new AbortController().signal;
export const ref = { owner: 'acme', repo: 'orders', ref: null };

/** Profile, pack, shards and source index of a fixture repo, packed in score order. */
export async function prepare(repo: FixtureRepo, tier: GroqTier) {
  const budget = TIER_PROFILES[tier];
  const source = new MemoryRepoSource(repo, { description: 'demo' });
  const profile = await profileRepo(source, await source.resolve(ref), signal);
  const pack = packFiles(
    profile.files.map((f) => ({ path: f.path, text: f.text })),
    budget,
  );
  const shards = shardPack(pack, budget);
  const texts = new Map(profile.files.map((f) => [f.path, f.text]));
  return { budget, source, profile, pack, shards, texts, index: buildSourceIndex(pack, texts) };
}
