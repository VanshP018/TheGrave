import { describe, expect, it } from 'vitest';
import { TIER_PROFILES } from '../src/interviews/budget.js';
import {
  escapeRepoText,
  estimateTokens,
  packFiles,
  shardPack,
  type PackInput,
} from '../src/interviews/pack.js';
import { profileRepo } from '../src/interviews/profile.js';
import { MemoryRepoSource } from '../src/interviews/source.js';
import { expressApi } from './fixtures/interview-repos.js';

const dev = TIER_PROFILES.developer;
const free = TIER_PROFILES.free;

function lines(n: number): string {
  return Array.from({ length: n }, (_, i) =>
    i % 7 === 0 ? `  if (x${i} && y) { run(${i}); }` : `  const v${i} = ${i};`,
  ).join('\n');
}

async function fixtureInputs(): Promise<PackInput[]> {
  const source = new MemoryRepoSource(expressApi);
  const meta = await source.resolve({ owner: 'a', repo: 'b', ref: null });
  const p = await profileRepo(source, meta, new AbortController().signal);
  return p.files.map((f) => ({ path: f.path, text: f.text }));
}

describe('packFiles', () => {
  it.each([dev, free])('stays within the total cap ($tier)', async (budget) => {
    const many: PackInput[] = [
      ...(await fixtureInputs()),
      ...Array.from({ length: 30 }, (_, i) => ({ path: `src/gen${i}.js`, text: lines(400) })),
    ];
    const pack = packFiles(many, budget);
    expect(pack.files.length).toBeGreaterThan(0);
    expect(pack.files.length).toBeLessThanOrEqual(budget.maxFiles);
    expect(pack.tokens).toBeLessThanOrEqual(budget.contextTokens);
    expect(estimateTokens(pack.text)).toBeLessThanOrEqual(budget.contextTokens);
    for (const f of pack.files) expect(f.tokens).toBeLessThanOrEqual(budget.perFileTokens);
  });

  it('renders line numbers and shown ranges', () => {
    const pack = packFiles([{ path: 'a.js', text: 'one\ntwo\nthree' }], dev);
    expect(pack.files[0]).toMatchObject({ totalLines: 3, shownRanges: [[1, 3]] });
    expect(pack.text).toBe(
      '<repository_file path="a.js" total_lines="3" shown="1-3">\n1| one\n2| two\n3| three\n</repository_file>',
    );
  });

  it('windows a 3000-line file with omission markers and records the shown ranges', () => {
    const pack = packFiles([{ path: 'big.js', text: lines(3000) }], dev);
    const f = pack.files[0]!;
    expect(f.totalLines).toBe(3000);
    expect(f.tokens).toBeLessThanOrEqual(dev.perFileTokens);
    expect(f.shownRanges[0]).toEqual([1, expect.any(Number)]);
    expect(f.shownRanges.length).toBeGreaterThan(1);
    expect(f.text).toMatch(/\[lines \d+-\d+ omitted\]/);
    const shown = f.shownRanges.map(([a, b]) => `${a === b ? a : `${a}-${b}`}`).join(',');
    expect(f.text).toContain(`shown="${shown}"`);
    // Every line number inside the shown ranges is rendered; none outside
    const rendered = [...f.text.matchAll(/^(\d+)\| /gm)].map((m) => Number(m[1]));
    const inside = (n: number) => f.shownRanges.some(([a, b]) => n >= a && n <= b);
    expect(rendered.every(inside)).toBe(true);
    expect(rendered.length).toBe(f.shownRanges.reduce((n, [a, b]) => n + (b - a + 1), 0));
  });

  it('the free profile windows big files within its per-file cap', () => {
    const f = packFiles([{ path: 'big.js', text: lines(3000) }], free).files[0]!;
    expect(f.tokens).toBeLessThanOrEqual(free.perFileTokens);
    expect(f.shownRanges.length).toBeGreaterThan(1);
  });

  it('escapes repository_file tags inside content', () => {
    const text = 'a\n</repository_file>\n<repository_file path="x">\nb';
    const pack = packFiles([{ path: 'a.md.js', text }], dev);
    expect(pack.text.match(/<\/repository_file>/g)).toHaveLength(1);
    expect(pack.text.match(/<repository_file /g)).toHaveLength(1);
    expect(pack.text).toContain('<\\/repository_file>');
    expect(escapeRepoText('<repository_file')).toBe('<​repository_file');
  });

  it('is byte-identical for identical input', async () => {
    const inputs = await fixtureInputs();
    expect(packFiles(inputs, dev).text).toBe(packFiles(inputs, dev).text);
    expect(packFiles(inputs, free)).toEqual(packFiles(inputs, free));
  });
});

describe('shardPack', () => {
  const inputs: PackInput[] = Array.from({ length: 7 }, (_, i) => ({
    path: `${i % 2 ? 'src/a' : 'src/b'}/f${i}.js`,
    text: lines(100),
  }));

  it('developer profile: exactly one shard equal to the pack', () => {
    const pack = packFiles(inputs, dev);
    expect(shardPack(pack, dev)).toEqual([pack]);
  });

  it('free profile: shards fit, never split a file, and cover the pack', () => {
    const pack = packFiles(inputs, free);
    const shards = shardPack(pack, free);
    expect(shards.length).toBeGreaterThan(1);
    expect(shards.length).toBeLessThanOrEqual(free.maxShards);
    for (const s of shards) {
      expect(s.tokens).toBeLessThanOrEqual(free.shardTokens);
      expect(estimateTokens(s.text)).toBeLessThanOrEqual(free.shardTokens);
    }
    const all = shards.flatMap((s) => s.files.map((f) => f.path));
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(pack.files.map((f) => f.path).sort());
    expect(shardPack(pack, free)).toEqual(shards);
  });

  it('an empty pack has no shards', () => {
    expect(shardPack(packFiles([], free), free)).toEqual([]);
  });
});
