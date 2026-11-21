import type { TierBudget } from './budget.js';

/** Conservative token estimate for code (plan.md section 6): deterministic, no API call. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.2);
}

export interface PackInput {
  path: string;
  /** Redacted file text. */
  text: string;
}

export interface PackedFile {
  path: string;
  totalLines: number;
  /** Inclusive 1-based line ranges the model sees; citations are only valid inside these. */
  shownRanges: [number, number][];
  /** The rendered <repository_file> block. */
  text: string;
  tokens: number;
}

export interface Pack {
  files: PackedFile[];
  text: string;
  tokens: number;
}

const HEAD_LINES = { developer: 60, free: 30 } as const;
const WINDOW_LINES = 20;
/** A file cut down to fewer lines than this is not worth the tokens. */
const MIN_SHOWN_LINES = 10;
const COMPLEXITY_RE = /\b(?:if|for|while|case|catch)\b|&&|\|\|/g;

/** File content can never close or open a block: both tags are neutralised. */
export function escapeRepoText(text: string): string {
  return text
    .replaceAll('</repository_file', '<\\/repository_file')
    .replaceAll('<repository_file', '<​repository_file');
}

function attr(value: string): string {
  return escapeRepoText(value).replaceAll('"', '%22').replaceAll('\n', ' ');
}

export function renderFile(path: string, lines: string[], ranges: [number, number][]): string {
  const n = lines.length;
  const shown = ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',');
  const out = [`<repository_file path="${attr(path)}" total_lines="${n}" shown="${shown}">`];
  let next = 1;
  for (const [a, b] of ranges) {
    if (a > next) out.push(`[lines ${next}-${a - 1} omitted]`);
    for (let i = a; i <= b; i++) out.push(`${i}| ${escapeRepoText(lines[i - 1]!)}`);
    next = b + 1;
  }
  if (next <= n) out.push(`[lines ${next}-${n} omitted]`);
  out.push('</repository_file>');
  return out.join('\n');
}

function merge(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/**
 * Pick the line ranges of one file that fit `capTokens`: everything if it fits, otherwise the head plus the
 * windows around the densest branching code. Null when not even a useful head fits.
 */
export function windowFile(
  path: string,
  lines: string[],
  capTokens: number,
  headLines: number,
): [number, number][] | null {
  const n = lines.length;
  const cost = (r: [number, number][]) => estimateTokens(renderFile(path, lines, r));
  if (cost([[1, n]]) <= capTokens) return [[1, n]];

  let head = Math.min(headLines, n);
  while (head >= MIN_SHOWN_LINES && cost([[1, head]]) > capTokens) head = Math.floor(head * 0.8);
  if (head < MIN_SHOWN_LINES) return null;

  const blocks: { start: number; end: number; density: number }[] = [];
  for (let start = head + 1; start <= n; start += WINDOW_LINES) {
    const end = Math.min(n, start + WINDOW_LINES - 1);
    let density = 0;
    for (let i = start; i <= end; i++) density += lines[i - 1]!.match(COMPLEXITY_RE)?.length ?? 0;
    if (density > 0) blocks.push({ start, end, density });
  }
  blocks.sort((a, b) => b.density - a.density || a.start - b.start);

  let ranges: [number, number][] = [[1, head]];
  for (const b of blocks) {
    const trial = merge([...ranges, [b.start, b.end]]);
    if (cost(trial) <= capTokens) ranges = trial;
  }
  return ranges;
}

/**
 * Line-numbered pack in the given order (callers put manifests first, then triage order). Deterministic: the same
 * input always yields the same bytes. Stops at the total cap; a file that only partly fits is windowed further.
 */
export function packFiles(inputs: PackInput[], budget: TierBudget): Pack {
  const headLines = HEAD_LINES[budget.tier];
  const files: PackedFile[] = [];
  let total = 0;
  for (const input of inputs) {
    if (files.length >= budget.maxFiles) break;
    const remaining = budget.contextTokens - total;
    if (remaining <= 0) break;
    const lines = input.text.split('\n');
    const ranges = windowFile(
      input.path,
      lines,
      Math.min(budget.perFileTokens, remaining),
      headLines,
    );
    if (!ranges) continue;
    const text = renderFile(input.path, lines, ranges);
    const tokens = estimateTokens(text);
    files.push({ path: input.path, totalLines: lines.length, shownRanges: ranges, text, tokens });
    total += tokens;
  }
  return { files, text: files.map((f) => f.text).join('\n'), tokens: total };
}

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

function toPack(files: PackedFile[]): Pack {
  return {
    files,
    text: files.map((f) => f.text).join('\n'),
    tokens: files.reduce((n, f) => n + f.tokens, 0),
  };
}

/**
 * Split the pack into writer-sized shards. Developer tier: exactly one shard. Otherwise files are grouped by
 * directory (first appearance order), then packed greedily into shards of at most `shardTokens`, never splitting
 * a file; shards beyond `maxShards` are dropped (the pack is already capped so this is rare).
 */
export function shardPack(pack: Pack, budget: TierBudget): Pack[] {
  if (pack.files.length === 0) return [];
  if (budget.maxShards <= 1) return [pack];

  const firstSeen = new Map<string, number>();
  pack.files.forEach((f, i) => {
    const d = dirOf(f.path);
    if (!firstSeen.has(d)) firstSeen.set(d, i);
  });
  const ordered = pack.files
    .map((f, i) => ({ f, i }))
    .sort((a, b) => firstSeen.get(dirOf(a.f.path))! - firstSeen.get(dirOf(b.f.path))! || a.i - b.i)
    .map((x) => x.f);

  const shards: PackedFile[][] = [];
  let cur: PackedFile[] = [];
  let curTokens = 0;
  for (const f of ordered) {
    if (cur.length > 0 && curTokens + f.tokens > budget.shardTokens) {
      shards.push(cur);
      cur = [];
      curTokens = 0;
    }
    cur.push(f);
    curTokens += f.tokens;
  }
  if (cur.length > 0) shards.push(cur);
  return shards.slice(0, budget.maxShards).map(toPack);
}
