import { range } from './problems.js';
import type { Rng } from './rng.js';

/** `n - 1` tree edges on vertices 1..n; a larger `reach` lets a parent be further back, so the tree is bushier. */
export const randomTree = (r: Rng, n: number, reach = Infinity): number[][] =>
  range(n - 1, (i) => {
    const v = i + 2;
    return [r.int(Math.max(1, v - reach), v - 1), v];
  });

/** Hides the build order: random vertex labels and random edge orientation. */
export const relabel = (r: Rng, n: number, edges: number[][]): number[][] => {
  const perm = r.shuffle(range(n, (i) => i + 1));
  return edges.map(([a, b]) => {
    const u = perm[a! - 1]!;
    const v = perm[b! - 1]!;
    return r.float() < 0.5 ? [u, v] : [v, u];
  });
};

/** `m` edges between distinct random vertices (parallel edges may occur). */
export const randomEdges = (r: Rng, n: number, m: number): number[][] => {
  const out: number[][] = [];
  while (out.length < m) {
    const a = r.int(1, n);
    const b = r.int(1, n);
    if (a !== b) out.push([a, b]);
  }
  return out;
};

/** `m` distinct undirected edges, no self-loops and no parallels. */
export const randomSimpleEdges = (r: Rng, n: number, m: number): number[][] => {
  const seen = new Set<number>();
  const out: number[][] = [];
  while (out.length < m) {
    const a = r.int(1, n);
    const b = r.int(1, n);
    if (a === b) continue;
    const key = Math.min(a, b) * (n + 1) + Math.max(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([a, b]);
  }
  return out;
};

/** "n" on the first line, then the edges, one per line (trees: n - 1 of them). */
export const treeInput = (n: number, edges: number[][]) =>
  `${n}\n${edges.map((e) => e.join(' ')).join('\n')}${edges.length ? '\n' : ''}`;

/** Adjacency lists (1-based) of an undirected graph. */
export const adjacency = (n: number, edges: number[][]): number[][] => {
  const adj: number[][] = range(n + 1, () => []);
  for (const [a, b] of edges) {
    adj[a!]!.push(b!);
    adj[b!]!.push(a!);
  }
  return adj;
};
