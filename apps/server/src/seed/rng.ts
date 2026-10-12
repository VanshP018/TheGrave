/** Deterministic PRNG (mulberry32) so seeding is reproducible: same slug → same hidden tests. */
export function createRng(seed: number) {
  let s = seed >>> 0;
  const float = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(float() * (hi - lo + 1));
  return {
    float,
    int,
    ints: (n: number, lo: number, hi: number) => Array.from({ length: n }, () => int(lo, hi)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(float() * items.length)]!,
    shuffle<T>(items: T[]): T[] {
      for (let i = items.length - 1; i > 0; i--) {
        const j = int(0, i);
        [items[i], items[j]] = [items[j]!, items[i]!];
      }
      return items;
    },
    word: (len: number, alphabet = 'abcdefghijklmnopqrstuvwxyz') =>
      Array.from({ length: len }, () => alphabet[Math.floor(float() * alphabet.length)]).join(''),
  };
}
export type Rng = ReturnType<typeof createRng>;

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Binary min-heap keyed by the first tuple element. */
export class MinHeap<T extends [number, ...unknown[]]> {
  private items: T[] = [];
  get size() {
    return this.items.length;
  }
  push(item: T) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]![0] <= a[i]![0]) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]![0] < a[m]![0]) m = l;
        if (r < a.length && a[r]![0] < a[m]![0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}
