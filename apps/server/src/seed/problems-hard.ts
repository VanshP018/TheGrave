import {
  arrInput,
  edgeInput,
  lines,
  nums,
  py,
  range,
  statement,
  type ProblemDef,
} from './problems.js';
import { randomEdges, randomSimpleEdges, randomTree, relabel } from './problems-gen.js';

const MOD = 1_000_000_007;
const pairLines = (rows: number[][]) => rows.map((p) => p.join(' ')).join('\n');

/** A DAG on 1..n whose edges all go from a smaller to a larger vertex, with the middle labels shuffled. */
const shuffleMiddle = (r: Parameters<typeof relabel>[0], n: number, edges: number[][]) => {
  const perm = [1, ...r.shuffle(range(Math.max(n - 2, 0), (i) => i + 2)), n];
  return edges.map(([a, b]) => [perm[a! - 1]!, perm[b! - 1]!]);
};

/** Original hard problems: each has a worked example in the statement, 2 samples and 5-6 hidden tests. */
export const hardProblems: ProblemDef[] = [
  {
    slug: 'longest-valid-parens',
    title: 'Longest Well-Formed Stretch',
    difficulty: 'HARD',
    statement: statement(
      `A string consists of the characters \`(\` and \`)\`. A string is **well-formed** if every \`(\` can be matched with a later \`)\` and every \`)\` with an earlier \`(\`, with matched pairs properly nested: \`()\`, \`(())\` and \`()()\` are well-formed, while \`)(\`, \`(()\` and \`())\` are not. The empty string is not counted.

Find the length of the **longest well-formed substring** (a block of consecutive characters) of the given string, or 0 if there is none.

For \`(()\` the answer is 2 (the substring \`()\`). For \`)()())\` it is 4 (the substring \`()()\`). A solution that checks every substring is too slow for the largest inputs.`,
      'A single line containing the string, made only of `(` and `)`.',
      'Print the length of the longest well-formed substring.',
      ['1 ≤ length ≤ 2·10^5'],
    ),
    samples: ['(()\n', ')()())\n'],
    hidden: (r) => [
      `${'('.repeat(200000)}\n`,
      `${'()'.repeat(100000)}\n`,
      `${'('.repeat(100000)}${')'.repeat(100000)}\n`,
      `${')('.repeat(100000)}\n`,
      `${r.word(200000, '()')}\n`,
      `${r.word(200000, '(()')}\n`,
    ],
    solve: (s) => {
      const t = lines(s)[0]!;
      const stack = [-1];
      let best = 0;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === '(') stack.push(i);
        else {
          stack.pop();
          if (stack.length === 0) stack.push(i);
          else best = Math.max(best, i - stack[stack.length - 1]!);
        }
      }
      return String(best);
    },
    python: py(`
      s = input().strip()
      n = len(s)
      dp = [0] * n  # dp[i] = length of the longest well-formed substring ending exactly at i
      best = 0
      for i in range(1, n):
          if s[i] == ')':
              if s[i - 1] == '(':
                  dp[i] = (dp[i - 2] if i >= 2 else 0) + 2
              else:
                  j = i - dp[i - 1] - 1
                  if j >= 0 and s[j] == '(':
                      dp[i] = dp[i - 1] + 2 + (dp[j - 1] if j >= 1 else 0)
              if dp[i] > best:
                  best = dp[i]
      print(best)
    `),
  },
  {
    slug: 'lcs-length',
    title: 'Longest Shared Melody',
    difficulty: 'HARD',
    statement: statement(
      `Two songs are written as strings of notes (lowercase letters). A **subsequence** of a string keeps some of its characters in their original order but may skip characters in between; for example \`ace\` is a subsequence of \`abcde\`.

Find the length of the **longest common subsequence** of the two strings: the longest string that is a subsequence of both.

For \`abcde\` and \`ace\` the answer is 3 (\`ace\`). For \`abc\` and \`def\` the strings share no letter, so the answer is 0.`,
      'The first line contains the string `a`. The second line contains the string `b`.',
      'Print the length of their longest common subsequence.',
      ['1 ≤ |a|, |b| ≤ 2000'],
    ),
    samples: ['abcde\nace\n', 'abc\ndef\n'],
    hidden: (r) => {
      const same = r.word(2000);
      return [
        `${same}\n${same}\n`,
        `${r.word(2000, 'ab')}\n${r.word(2000, 'ab')}\n`,
        `${r.word(2000)}\n${r.word(2000)}\n`,
        `${'a'.repeat(2000)}\n${'a'.repeat(1000)}\n`,
        'q\nq\n',
        `${r.word(2000, 'abcd')}\n${r.word(1500, 'wxyz')}\n`,
      ];
    },
    solve: (s) => {
      const [a, b] = lines(s);
      const n = a!.length;
      const m = b!.length;
      let prev = new Int32Array(m + 1);
      for (let i = 1; i <= n; i++) {
        const cur = new Int32Array(m + 1);
        for (let j = 1; j <= m; j++)
          cur[j] = a![i - 1] === b![j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
        prev = cur;
      }
      return String(prev[m]);
    },
    python: py(`
      a = input().strip()
      b = input().strip()
      n = len(a)
      # bit-parallel LCS: one big integer holds a whole DP row
      masks = {}
      for i, c in enumerate(a):
          masks[c] = masks.get(c, 0) | (1 << i)
      full = (1 << n) - 1
      v = full
      for c in b:
          m = masks.get(c, 0)
          u = v & m
          v = ((v + u) | (v & ~m)) & full
      print(n - bin(v).count('1'))
    `),
  },
  {
    slug: 'min-palindrome-cuts',
    title: 'Cut Into Palindromes',
    difficulty: 'HARD',
    timeLimitMs: 2000,
    statement: statement(
      `Cut a string into consecutive pieces so that **every piece is a palindrome** (reads the same forwards and backwards). Find the **minimum number of cuts** needed.

For \`aab\` the answer is 1: cut between the second \`a\` and the \`b\` to get \`aa\` and \`b\`. For \`racecar\` the whole string is already a palindrome, so 0 cuts are needed. In the worst case a string of \`n\` distinct letters needs \`n - 1\` cuts, because only single letters are palindromes.`,
      'A single line containing a string `s` of lowercase letters.',
      'Print the minimum number of cuts.',
      ['1 ≤ |s| ≤ 1500'],
    ),
    samples: ['aab\n', 'racecar\n'],
    hidden: (r) => [
      `${'a'.repeat(1500)}\n`,
      `${r.word(1500, 'abc')}\n`,
      `${'ab'.repeat(750)}\n`,
      `${r.word(1500)}\n`,
      `${'abacaba'.repeat(200)}\n`,
      'z\n',
    ],
    solve: (s) => {
      const t = lines(s)[0]!;
      const n = t.length;
      const pieces = Array.from({ length: n + 1 }, (_, i) => i); // pieces[i]: fewest pieces for the first i chars
      pieces[0] = 0;
      for (let c = 0; c < n; c++) {
        for (const [lo, hi] of [
          [c, c],
          [c, c + 1],
        ] as const) {
          let l = lo;
          let r = hi;
          while (l >= 0 && r < n && t[l] === t[r]) {
            pieces[r + 1] = Math.min(pieces[r + 1]!, pieces[l]! + 1);
            l--;
            r++;
          }
        }
      }
      return String(pieces[n]! - 1);
    },
    python: py(`
      s = input().strip()
      n = len(s)
      pal = [[False] * n for _ in range(n)]
      for i in range(n - 1, -1, -1):
          for j in range(i, n):
              if s[i] == s[j] and (j - i < 2 or pal[i + 1][j - 1]):
                  pal[i][j] = True
      cuts = [0] * n  # cuts[j]: minimum cuts for s[0..j]
      for j in range(n):
          if pal[0][j]:
              cuts[j] = 0
          else:
              cuts[j] = min(cuts[i - 1] + 1 for i in range(1, j + 1) if pal[i][j])
      print(cuts[n - 1])
    `),
  },
  {
    slug: 'k-edge-shortest-path',
    title: 'Cheapest Route with Few Flights',
    difficulty: 'HARD',
    timeLimitMs: 2000,
    statement: statement(
      `An airline has \`n\` cities and \`m\` **one-way** flights; flight \`i\` goes from city \`ui\` to city \`vi\` and costs \`wi\`. You start in city 1 and want to reach city \`n\` using **at most \`k\` flights**. Find the minimum total cost, or -1 if city \`n\` cannot be reached with at most \`k\` flights.

The cheapest route overall might use many flights and be too long. With flights \`1→2\` (1), \`2→4\` (1), \`1→3\` (1), \`3→4\` (5), \`1→4\` (10): with \`k = 2\` the best route is \`1→2→4\` for a total of 2; with \`k = 1\` only the direct flight \`1→4\` is allowed, so the answer is 10.

Several flights may connect the same pair of cities. If \`n = 1\`, you are already there and the cost is 0.`,
      'The first line contains `n m k`. Each of the next `m` lines contains `u v w`, a flight from `u` to `v` costing `w`.',
      'Print the minimum cost using at most `k` flights, or -1.',
      ['1 ≤ n ≤ 1000', '0 ≤ m ≤ 5000', '1 ≤ k ≤ 30', '1 ≤ w ≤ 10^6, u ≠ v'],
    ),
    samples: [
      '4 5 2\n1 2 1\n2 4 1\n1 3 1\n3 4 5\n1 4 10\n',
      '4 5 1\n1 2 1\n2 4 1\n1 3 1\n3 4 5\n1 4 10\n',
    ],
    hidden: (r) => {
      const build = (n: number, k: number, edges: number[][]) =>
        `${n} ${edges.length} ${k}\n${pairLines(edges)}${edges.length ? '\n' : ''}`;
      const weighted = (edges: number[][], max: number) =>
        edges.map(([a, b]) => [a!, b!, r.int(1, max)]);
      const chain = range(30, (i) => [i + 1, i + 2, 1]);
      return [
        build(1, 5, []),
        build(31, 30, [...chain, [1, 31, 1000]]),
        build(31, 29, [...chain, [1, 31, 1000]]),
        build(1000, 30, weighted(randomEdges(r, 1000, 5000), 1000000)),
        build(
          1000,
          30,
          weighted(randomEdges(r, 999, 4000), 1000), // nothing reaches city 1000
        ),
        build(20, 5, weighted(randomEdges(r, 20, 200), 50)),
      ];
    },
    solve: (s) => {
      const [n, m, k, ...rest] = nums(s);
      let cur = new Float64Array(n! + 1).fill(Infinity);
      cur[1] = 0;
      for (let round = 0; round < k!; round++) {
        const next = cur.slice();
        for (let i = 0; i < m!; i++) {
          const u = rest[3 * i]!;
          const v = rest[3 * i + 1]!;
          const w = rest[3 * i + 2]!;
          if (cur[u]! + w < next[v]!) next[v] = cur[u]! + w;
        }
        cur = next;
      }
      return String(cur[n!] === Infinity ? -1 : cur[n!]);
    },
    python: py(`
      import sys, heapq
      d = sys.stdin.buffer.read().split()
      n, m, k = int(d[0]), int(d[1]), int(d[2])
      adj = [[] for _ in range(n + 1)]
      for i in range(m):
          u, v, w = int(d[3 + 3 * i]), int(d[4 + 3 * i]), int(d[5 + 3 * i])
          adj[u].append((v, w))
      # Dijkstra over states (city, flights used so far)
      heap = [(0, 1, 0)]
      seen = set()
      ans = -1
      while heap:
          cost, v, used = heapq.heappop(heap)
          if (v, used) in seen:
              continue
          seen.add((v, used))
          if v == n:
              ans = cost
              break
          if used == k:
              continue
          for to, w in adj[v]:
              if (to, used + 1) not in seen:
                  heapq.heappush(heap, (cost + w, to, used + 1))
      print(ans)
    `),
  },
  {
    slug: 'scc-count',
    title: 'Mutually Reachable Groups',
    difficulty: 'HARD',
    timeLimitMs: 2000,
    statement: statement(
      `A one-way road network has \`n\` junctions and \`m\` directed roads. Two junctions are in the same **group** if you can drive from each to the other (a junction is always reachable from itself). These groups are the **strongly connected components** of the network, and every junction belongs to exactly one group.

Print the number of groups and the size of the largest group.

For the roads \`1→2\`, \`2→3\`, \`3→1\`, \`3→4\`, \`4→5\` the groups are \`{1,2,3}\`, \`{4}\` and \`{5}\`: 3 groups, the largest having 3 junctions, so the output is \`3 3\`. With 3 junctions and no roads every junction is alone: \`3 1\`.

Recursion may overflow the stack on long chains, so use an iterative search.`,
      'The first line contains `n m`. Each of the next `m` lines contains a directed road `u v`.',
      'Print two integers: the number of groups and the size of the largest group.',
      ['1 ≤ n ≤ 10^5', '0 ≤ m ≤ 2·10^5', '1 ≤ u, v ≤ n, u ≠ v'],
    ),
    samples: ['5 5\n1 2\n2 3\n3 1\n3 4\n4 5\n', '3 0\n'],
    hidden: (r) => {
      const forward = range(200000, () => {
        const a = r.int(1, 99999);
        return [a, r.int(a + 1, 100000)];
      });
      return [
        edgeInput(1, []),
        edgeInput(100000, forward),
        edgeInput(
          100000,
          range(100000, (i) => [i + 1, ((i + 1) % 100000) + 1]),
        ),
        edgeInput(100000, randomEdges(r, 100000, 100000)),
        edgeInput(1000, randomEdges(r, 1000, 5000)),
        edgeInput(100000, [
          ...range(50000, (i) => [i + 1, ((i + 1) % 50000) + 1]),
          ...range(50000, (i) => [50001 + i, 50001 + ((i + 1) % 50000)]),
          [1, 50001],
        ]),
      ];
    },
    solve: (s) => {
      const [n, m, ...rest] = nums(s);
      const adj: number[][] = range(n! + 1, () => []);
      for (let i = 0; i < m!; i++) adj[rest[2 * i]!]!.push(rest[2 * i + 1]!);
      const idx = new Int32Array(n! + 1).fill(-1);
      const low = new Int32Array(n! + 1);
      const onStack = new Uint8Array(n! + 1);
      const ptr = new Int32Array(n! + 1);
      const stack: number[] = [];
      const call: number[] = [];
      let counter = 0;
      let comps = 0;
      let largest = 0;
      for (let s0 = 1; s0 <= n!; s0++) {
        if (idx[s0] !== -1) continue;
        idx[s0] = low[s0] = counter++;
        stack.push(s0);
        onStack[s0] = 1;
        call.push(s0);
        while (call.length) {
          const v = call[call.length - 1]!;
          if (ptr[v]! < adj[v]!.length) {
            const w = adj[v]![ptr[v]!++]!;
            if (idx[w] === -1) {
              idx[w] = low[w] = counter++;
              stack.push(w);
              onStack[w] = 1;
              call.push(w);
            } else if (onStack[w]) low[v] = Math.min(low[v]!, idx[w]!);
          } else {
            call.pop();
            if (call.length) {
              const p = call[call.length - 1]!;
              low[p] = Math.min(low[p]!, low[v]!);
            }
            if (low[v] === idx[v]) {
              let size = 0;
              let w: number;
              do {
                w = stack.pop()!;
                onStack[w] = 0;
                size++;
              } while (w !== v);
              comps++;
              largest = Math.max(largest, size);
            }
          }
        }
      }
      return `${comps} ${largest}`;
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      n, m = int(d[0]), int(d[1])
      adj = [[] for _ in range(n + 1)]
      radj = [[] for _ in range(n + 1)]
      for i in range(m):
          u, v = int(d[2 + 2 * i]), int(d[3 + 2 * i])
          adj[u].append(v)
          radj[v].append(u)
      # Kosaraju: finishing order on the graph, then sweep the reversed graph in reverse finishing order
      seen = [False] * (n + 1)
      it = [0] * (n + 1)
      order = []
      for s in range(1, n + 1):
          if seen[s]:
              continue
          seen[s] = True
          st = [s]
          while st:
              v = st[-1]
              if it[v] < len(adj[v]):
                  w = adj[v][it[v]]
                  it[v] += 1
                  if not seen[w]:
                      seen[w] = True
                      st.append(w)
              else:
                  st.pop()
                  order.append(v)
      comp = [0] * (n + 1)
      comps = 0
      largest = 0
      for s in reversed(order):
          if comp[s]:
              continue
          comps += 1
          comp[s] = comps
          st = [s]
          size = 0
          while st:
              v = st.pop()
              size += 1
              for w in radj[v]:
                  if not comp[w]:
                      comp[w] = comps
                      st.append(w)
          largest = max(largest, size)
      print(comps, largest)
    `),
  },
  {
    slug: 'bridge-count',
    title: 'Critical Cables',
    difficulty: 'HARD',
    timeLimitMs: 2000,
    statement: statement(
      `A data centre has \`n\` servers joined by \`m\` two-way cables; no two servers are joined by more than one cable. A cable is **critical** (a *bridge*) if cutting it increases the number of groups of servers that can still reach each other.

For the cables \`1-2\`, \`2-3\`, \`3-1\`, \`3-4\`, \`4-5\`: the triangle \`1-2-3\` stays connected whichever of its cables is cut, but cutting \`3-4\` separates servers 4 and 5 from the rest, and cutting \`4-5\` separates server 5. That makes **2** critical cables. In a chain \`1-2-3-4\` all 3 cables are critical.

The network may be disconnected. Count the critical cables.`,
      'The first line contains `n m`. Each of the next `m` lines contains two servers `u v` joined by a cable.',
      'Print the number of critical cables.',
      ['1 ≤ n ≤ 10^5', '0 ≤ m ≤ 2·10^5', 'no self-loops and no repeated cables'],
    ),
    samples: ['5 5\n1 2\n2 3\n3 1\n3 4\n4 5\n', '4 3\n1 2\n2 3\n3 4\n'],
    hidden: (r) => {
      const clique = (offset: number, size: number) =>
        Array.from({ length: size }, (_, a) =>
          Array.from({ length: size - a - 1 }, (_, b) => [offset + a + 1, offset + a + b + 2]),
        ).flat();
      return [
        edgeInput(100000, relabel(r, 100000, randomTree(r, 100000))),
        edgeInput(
          100000,
          range(100000, (i) => [i + 1, ((i + 1) % 100000) + 1]),
        ),
        edgeInput(100000, randomSimpleEdges(r, 100000, 100000)),
        edgeInput(100, [...clique(0, 50), ...clique(50, 50), [50, 51]]),
        edgeInput(500, randomSimpleEdges(r, 500, 5000)),
        edgeInput(1000, randomSimpleEdges(r, 1000, 400)),
      ];
    },
    solve: (s) => {
      const [n, m, ...rest] = nums(s);
      const adjV: number[][] = range(n! + 1, () => []);
      const adjE: number[][] = range(n! + 1, () => []);
      for (let e = 0; e < m!; e++) {
        const u = rest[2 * e]!;
        const v = rest[2 * e + 1]!;
        adjV[u]!.push(v);
        adjE[u]!.push(e);
        adjV[v]!.push(u);
        adjE[v]!.push(e);
      }
      const tin = new Int32Array(n! + 1).fill(-1);
      const low = new Int32Array(n! + 1);
      const parentEdge = new Int32Array(n! + 1).fill(-1);
      const ptr = new Int32Array(n! + 1);
      let timer = 0;
      let bridges = 0;
      for (let s0 = 1; s0 <= n!; s0++) {
        if (tin[s0] !== -1) continue;
        tin[s0] = low[s0] = timer++;
        const call = [s0];
        while (call.length) {
          const v = call[call.length - 1]!;
          if (ptr[v]! < adjV[v]!.length) {
            const i = ptr[v]!++;
            const w = adjV[v]![i]!;
            if (adjE[v]![i] === parentEdge[v]) continue;
            if (tin[w] === -1) {
              parentEdge[w] = adjE[v]![i]!;
              tin[w] = low[w] = timer++;
              call.push(w);
            } else low[v] = Math.min(low[v]!, tin[w]!);
          } else {
            call.pop();
            if (call.length) {
              const p = call[call.length - 1]!;
              low[p] = Math.min(low[p]!, low[v]!);
              if (low[v]! > tin[p]!) bridges++;
            }
          }
        }
      }
      return String(bridges);
    },
    python: py(`
      import sys, random
      d = sys.stdin.buffer.read().split()
      n, m = int(d[0]), int(d[1])
      eu = [int(d[2 + 2 * i]) for i in range(m)]
      ev = [int(d[3 + 2 * i]) for i in range(m)]
      adj = [[] for _ in range(n + 1)]
      for e in range(m):
          adj[eu[e]].append((ev[e], e))
          adj[ev[e]].append((eu[e], e))
      # Spanning forest by BFS. A tree edge is a bridge exactly when no non-tree edge jumps over it. Give every
      # non-tree edge a random 62-bit label, xor it into both endpoints and sum subtrees: a zero subtree xor
      # means no non-tree edge crosses the edge above that subtree.
      rnd = random.Random(20261120)
      parent = [0] * (n + 1)
      seen = [False] * (n + 1)
      is_tree = [False] * m
      order = []
      for s in range(1, n + 1):
          if seen[s]:
              continue
          seen[s] = True
          queue = [s]
          for u in queue:
              order.append(u)
              for v, e in adj[u]:
                  if not seen[v]:
                      seen[v] = True
                      parent[v] = u
                      is_tree[e] = True
                      queue.append(v)
      acc = [0] * (n + 1)
      for e in range(m):
          if not is_tree[e]:
              h = rnd.getrandbits(62) + 1
              acc[eu[e]] ^= h
              acc[ev[e]] ^= h
      bridges = 0
      for v in reversed(order):
          p = parent[v]
          if p:
              if acc[v] == 0:
                  bridges += 1
              acc[p] ^= acc[v]
      print(bridges)
    `),
  },
  {
    slug: 'count-paths-dag',
    title: 'Distinct Routes Through the Pipeline',
    difficulty: 'HARD',
    timeLimitMs: 2000,
    statement: statement(
      `A build pipeline has \`n\` stages and \`m\` one-way dependencies \`u → v\`, forming a **directed acyclic graph** (you can never return to a stage you left). A **route** is a sequence of dependencies that leads from stage 1 to stage \`n\`. Two routes are different if they use different sequences of dependencies, so two parallel dependencies between the same stages give two different routes.

Count the routes from stage 1 to stage \`n\`, modulo \`1 000 000 007\`. If stage \`n\` cannot be reached, print 0.

For the dependencies \`1→2\`, \`1→3\`, \`2→3\`, \`2→4\`, \`3→4\` and \`n = 4\` there are 3 routes: \`1-2-4\`, \`1-3-4\` and \`1-2-3-4\`. For 3 stages and the single dependency \`1→2\` there is no route to stage 3, so the answer is 0.`,
      'The first line contains `n m`. Each of the next `m` lines contains a dependency `u v`.',
      'Print the number of routes from 1 to `n`, modulo 1000000007.',
      [
        '2 ≤ n ≤ 10^5',
        '0 ≤ m ≤ 2·10^5',
        'the graph has no directed cycle; parallel dependencies are allowed',
        'u ≠ v',
      ],
    ),
    samples: ['4 5\n1 2\n1 3\n2 3\n2 4\n3 4\n', '3 1\n1 2\n'],
    hidden: (r) => {
      const chain = (n: number) => range(n - 1, (i) => [i + 1, i + 2]);
      const extras = (n: number, count: number, reach: number) =>
        range(count, () => {
          const a = r.int(1, n - 1);
          return [a, Math.min(n, a + r.int(1, reach))];
        }).filter(([a, b]) => a !== b);
      const dag = (n: number, edges: number[][]) => edgeInput(n, shuffleMiddle(r, n, edges));
      return [
        edgeInput(2, [[1, 2]]),
        edgeInput(2, [
          [1, 2],
          [1, 2],
          [1, 2],
        ]),
        dag(40, [...chain(40), ...extras(40, 120, 5)]),
        dag(100000, [...chain(100000), ...extras(100000, 100000, 20)]),
        dag(
          100000,
          range(100000, () => {
            const a = r.int(1, 99999);
            return [a, r.int(a + 1, 100000)];
          }),
        ),
        dag(1000, [...chain(1000), ...extras(1000, 19000, 50)]),
      ];
    },
    solve: (s) => {
      const [n, m, ...rest] = nums(s);
      const adj: number[][] = range(n! + 1, () => []);
      const indeg = new Int32Array(n! + 1);
      for (let i = 0; i < m!; i++) {
        adj[rest[2 * i]!]!.push(rest[2 * i + 1]!);
        indeg[rest[2 * i + 1]!]!++;
      }
      const ways = new Array<number>(n! + 1).fill(0);
      ways[1] = 1;
      const queue: number[] = [];
      for (let v = 1; v <= n!; v++) if (indeg[v] === 0) queue.push(v);
      for (let h = 0; h < queue.length; h++) {
        const u = queue[h]!;
        for (const v of adj[u]!) {
          ways[v] = (ways[v]! + ways[u]!) % MOD;
          if (--indeg[v]! === 0) queue.push(v);
        }
      }
      return String(ways[n!]);
    },
    python: py(`
      import sys
      MOD = 10**9 + 7
      d = sys.stdin.buffer.read().split()
      n, m = int(d[0]), int(d[1])
      adj = [[] for _ in range(n + 1)]
      for i in range(m):
          adj[int(d[2 + 2 * i])].append(int(d[3 + 2 * i]))
      # f[v] = number of routes from v to n, computed over a DFS finishing order (children before parents)
      f = [0] * (n + 1)
      seen = [False] * (n + 1)
      it = [0] * (n + 1)
      seen[1] = True
      st = [1]
      while st:
          v = st[-1]
          if it[v] < len(adj[v]):
              w = adj[v][it[v]]
              it[v] += 1
              if not seen[w]:
                  seen[w] = True
                  st.append(w)
          else:
              st.pop()
              f[v] = 1 if v == n else sum(f[w] for w in adj[v]) % MOD
      print(f[1])
    `),
  },
  {
    slug: 'range-update-queries',
    title: 'Live Scoreboard',
    difficulty: 'HARD',
    timeLimitMs: 2000,
    statement: statement(
      `A scoreboard shows the scores of \`n\` players in a row. You must process \`q\` operations in order, of two kinds:

- \`1 i v\`: add \`v\` (which may be negative) to the score of player \`i\`.
- \`2 l r\`: report the **sum of the scores of players \`l\` through \`r\`** (inclusive) at this moment.

For scores \`1 2 3 4 5\` and the operations \`2 1 5\`, \`1 3 10\`, \`2 1 5\`, \`2 3 3\`, \`2 2 4\` the reports are 15, then 25 (player 3 now has 13), then 13, then 19. Recomputing each sum from scratch takes too long when both \`n\` and \`q\` are large: use a data structure that supports both operations quickly (a Fenwick tree or a segment tree).

At least one operation is a report.`,
      'The first line contains `n q`. The second line contains the `n` initial scores. Each of the next `q` lines is an operation `1 i v` or `2 l r`.',
      'For every operation of type 2, print the requested sum on its own line, in order.',
      [
        '1 ≤ n, q ≤ 10^5',
        '|initial score| ≤ 10^9 and |v| ≤ 10^9',
        '1 ≤ i ≤ n, 1 ≤ l ≤ r ≤ n',
        'sums fit in 64 bits',
      ],
    ),
    samples: [
      '5 5\n1 2 3 4 5\n2 1 5\n1 3 10\n2 1 5\n2 3 3\n2 2 4\n',
      '1 3\n7\n2 1 1\n1 1 -7\n2 1 1\n',
    ],
    hidden: (r) => {
      const build = (n: number, ops: number[][], init: number[]) =>
        `${n} ${ops.length}\n${init.join(' ')}\n${pairLines(ops)}\n`;
      const mixed = (n: number, q: number, updateProb: number, vmax: number) =>
        range(q, (i) => {
          if (i < q - 1 && r.float() < updateProb) return [1, r.int(1, n), r.int(-vmax, vmax)];
          const l = r.int(1, n);
          return [2, l, r.int(l, n)];
        });
      return [
        build(1, [[2, 1, 1]], [5]),
        build(100000, mixed(100000, 100000, 0, 1), r.ints(100000, -1e9, 1e9)),
        build(
          100000,
          range(100000, (i) => (i < 99999 ? [1, r.int(1, 100000), 1e9] : [2, 1, 100000])),
          range(100000, () => 1e9),
        ),
        build(100000, mixed(100000, 100000, 0.5, 1e9), r.ints(100000, -1e9, 1e9)),
        build(1000, mixed(1000, 5000, 0.3, 10), r.ints(1000, -5, 5)),
        build(100000, mixed(100000, 100000, 0.9, 1e9), r.ints(100000, 0, 1e9)),
      ];
    },
    solve: (s) => {
      const [n, q, ...rest] = nums(s);
      const tree = new Float64Array(2 * n!);
      for (let i = 0; i < n!; i++) tree[n! + i] = rest[i]!;
      for (let i = n! - 1; i >= 1; i--) tree[i] = tree[2 * i]! + tree[2 * i + 1]!;
      const out: number[] = [];
      for (let k = 0; k < q!; k++) {
        const type = rest[n! + 3 * k]!;
        const x = rest[n! + 3 * k + 1]!;
        const y = rest[n! + 3 * k + 2]!;
        if (type === 1) {
          let p = n! + x - 1;
          tree[p] = tree[p]! + y;
          while (p > 1) {
            p >>= 1;
            tree[p] = tree[2 * p]! + tree[2 * p + 1]!;
          }
        } else {
          let sum = 0;
          let lo = x - 1 + n!;
          let hi = y + n!;
          while (lo < hi) {
            if (lo & 1) sum += tree[lo++]!;
            if (hi & 1) sum += tree[--hi]!;
            lo >>= 1;
            hi >>= 1;
          }
          out.push(sum);
        }
      }
      return out.join('\n');
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      n, q = int(d[0]), int(d[1])
      bit = [0] * (n + 1)
      for i in range(1, n + 1):
          bit[i] += int(d[1 + i])
          j = i + (i & -i)
          if j <= n:
              bit[j] += bit[i]

      def prefix(i):
          s = 0
          while i > 0:
              s += bit[i]
              i -= i & -i
          return s

      out = []
      pos = 2 + n
      for _ in range(q):
          t, x, y = int(d[pos]), int(d[pos + 1]), int(d[pos + 2])
          pos += 3
          if t == 1:
              while x <= n:
                  bit[x] += y
                  x += x & -x
          else:
              out.append(prefix(y) - prefix(x - 1))
      print('\\n'.join(map(str, out)))
    `),
  },
  {
    slug: 'median-two-sorted',
    title: 'Median of Two Playlists',
    difficulty: 'HARD',
    statement: statement(
      `You are given two lists of numbers, each already sorted in non-decreasing order. Merge them mentally into one sorted list of \`n + m\` numbers and report its **median**: the middle element if \`n + m\` is odd, or the average of the two middle elements if \`n + m\` is even.

For \`1 3\` and \`2\` the merged list is \`1 2 3\` and the median is \`2\`. For \`1 2\` and \`3 4\` the merged list is \`1 2 3 4\` and the median is \`(2 + 3) / 2 = 2.5\`.

Print the median without a decimal point if it is a whole number, and with exactly one decimal digit \`.5\` otherwise. (An \`O(log(n + m))\` solution is possible by binary searching on how many elements of the first list lie in the lower half.)`,
      'The first line contains `n m`. The second line contains the `n` numbers of the first list. The third line contains the `m` numbers of the second list.',
      'Print the median, as described above.',
      ['1 ≤ n, m ≤ 10^5', '0 ≤ values ≤ 10^9', 'both lists are sorted in non-decreasing order'],
    ),
    samples: ['2 1\n1 3\n2\n', '2 2\n1 2\n3 4\n'],
    hidden: (r) => {
      const sorted = (n: number, lo: number, hi: number) => r.ints(n, lo, hi).sort((x, y) => x - y);
      const build = (a: number[], b: number[]) =>
        `${a.length} ${b.length}\n${a.join(' ')}\n${b.join(' ')}\n`;
      return [
        build([5], [5]),
        build(sorted(1000, 0, 100), sorted(1000, 1000, 1100)),
        build(
          range(50000, () => 7),
          range(50000, () => 7),
        ),
        build(sorted(100000, 0, 1e9), sorted(100000, 0, 1e9)),
        build([42], sorted(100000, 0, 1e9)),
        build(
          range(100000, (i) => 2 * i),
          range(99999, (i) => 2 * i + 1),
        ),
      ];
    },
    solve: (s) => {
      const [n, m, ...rest] = nums(s);
      let a = rest.slice(0, n);
      let b = rest.slice(n!, n! + m!);
      if (a.length > b.length) [a, b] = [b, a];
      const na = a.length;
      const nb = b.length;
      const half = Math.floor((na + nb + 1) / 2);
      let lo = 0;
      let hi = na;
      for (;;) {
        const i = (lo + hi) >> 1;
        const j = half - i;
        const aLeft = i > 0 ? a[i - 1]! : -Infinity;
        const aRight = i < na ? a[i]! : Infinity;
        const bLeft = j > 0 ? b[j - 1]! : -Infinity;
        const bRight = j < nb ? b[j]! : Infinity;
        if (aLeft <= bRight && bLeft <= aRight) {
          const lower = Math.max(aLeft, bLeft);
          if ((na + nb) % 2) return String(lower);
          const twice = lower + Math.min(aRight, bRight);
          return twice % 2 === 0 ? String(twice / 2) : `${(twice - 1) / 2}.5`;
        }
        if (aLeft > bRight) hi = i - 1;
        else lo = i + 1;
      }
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      n, m = int(d[0]), int(d[1])
      merged = sorted(map(int, d[2:2 + n + m]))
      t = n + m
      if t % 2:
          print(merged[t // 2])
      else:
          twice = merged[t // 2 - 1] + merged[t // 2]
          print(twice // 2 if twice % 2 == 0 else str(twice // 2) + '.5')
    `),
  },
  {
    slug: 'lis-count',
    title: 'How Many Longest Climbs',
    difficulty: 'HARD',
    timeLimitMs: 2000,
    statement: statement(
      `A **strictly increasing subsequence** of a sequence picks some elements, keeping their order, so that each picked element is larger than the one before it. Two subsequences are different if they pick different **positions**, even when the values are the same.

Find the length \`L\` of the **longest** strictly increasing subsequence, and the **number of distinct subsequences of that length**, modulo \`1 000 000 007\`.

For \`1 3 5 4 7\` the longest has length 4 and there are 2 of them: \`1 3 5 7\` and \`1 3 4 7\`. For \`2 2 2 2 2\` nothing can be strictly increasing past one element, so \`L = 1\` and each of the 5 positions is its own subsequence: the answer is \`1 5\`.`,
      'The first line contains `n`. The second line contains `n` integers `a1 … an`.',
      'Print two integers: `L` and the number of longest strictly increasing subsequences modulo 1000000007.',
      ['1 ≤ n ≤ 2000', '|ai| ≤ 10^9'],
    ),
    samples: ['5\n1 3 5 4 7\n', '5\n2 2 2 2 2\n'],
    hidden: (r) => [
      arrInput(range(2000, (i) => i)),
      arrInput(range(2000, (i) => 2000 - i)),
      arrInput(r.ints(2000, 0, 5)),
      arrInput(r.ints(2000, -1e9, 1e9)),
      arrInput(range(2000, (i) => (i % 2 === 0 ? i : i - 1))),
      arrInput(r.ints(2000, 0, 60)),
    ],
    solve: (s) => {
      const [n, ...rest] = nums(s);
      const a = rest.slice(0, n);
      const len = new Array<number>(n!).fill(1);
      const cnt = new Array<number>(n!).fill(1);
      for (let i = 0; i < n!; i++)
        for (let j = 0; j < i; j++) {
          if (a[j]! >= a[i]!) continue;
          if (len[j]! + 1 > len[i]!) {
            len[i] = len[j]! + 1;
            cnt[i] = cnt[j]!;
          } else if (len[j]! + 1 === len[i]!) cnt[i] = (cnt[i]! + cnt[j]!) % MOD;
        }
      const best = Math.max(...len);
      let total = 0;
      for (let i = 0; i < n!; i++) if (len[i] === best) total = (total + cnt[i]!) % MOD;
      return `${best} ${total}`;
    },
    python: py(`
      import sys
      MOD = 10**9 + 7
      d = sys.stdin.read().split()
      n = int(d[0])
      a = list(map(int, d[1:1 + n]))
      # work from the right: ln[i] / ways[i] describe the longest increasing runs that START at i
      ln = [1] * n
      ways = [1] * n
      for i in range(n - 1, -1, -1):
          for j in range(i + 1, n):
              if a[j] > a[i]:
                  if ln[j] + 1 > ln[i]:
                      ln[i] = ln[j] + 1
                      ways[i] = ways[j]
                  elif ln[j] + 1 == ln[i]:
                      ways[i] = (ways[i] + ways[j]) % MOD
      best = max(ln)
      print(best, sum(w for l, w in zip(ln, ways) if l == best) % MOD)
    `),
  },
  {
    slug: 'tsp-small',
    title: 'Courier Round Trip',
    difficulty: 'HARD',
    timeLimitMs: 2000,
    statement: statement(
      `A courier must visit all \`n\` cities. The trip starts in city 1, visits every other city **exactly once**, and returns to city 1. Travelling from city \`i\` to city \`j\` costs \`d[i][j]\`; the costs are not necessarily symmetric (\`d[i][j]\` may differ from \`d[j][i]\`) because of one-way streets and tolls. \`d[i][i] = 0\`.

Find the cheapest possible round trip.

For three cities with costs \`d[1][2] = 10\`, \`d[1][3] = 15\`, \`d[2][3] = 20\` (and symmetric) the trip \`1 → 2 → 3 → 1\` costs \`10 + 20 + 15 = 45\`, and the opposite direction costs the same, so the answer is 45. With a single city the cost is 0. Trying all \`(n-1)!\` orders is hopeless at \`n = 13\`; think about which cities have been visited so far.`,
      'The first line contains `n`. Each of the next `n` lines contains `n` integers: the row `d[i][1 … n]`.',
      'Print the minimum cost of a round trip.',
      ['1 ≤ n ≤ 13', '0 ≤ d[i][j] ≤ 1000'],
    ),
    samples: ['3\n0 10 15\n10 0 20\n15 20 0\n', '1\n0\n'],
    hidden: (r) => {
      const matrix = (n: number, f: (i: number, j: number) => number) =>
        `${n}\n${range(n, (i) => range(n, (j) => (i === j ? 0 : f(i, j))).join(' ')).join('\n')}\n`;
      const sym = (n: number) => {
        const m = range(n, () => range(n, () => 0));
        for (let i = 0; i < n; i++)
          for (let j = i + 1; j < n; j++) m[i]![j] = m[j]![i] = r.int(1, 1000);
        return matrix(n, (i, j) => m[i]![j]!);
      };
      return [
        matrix(2, (i, j) => (i < j ? 7 : 11)),
        matrix(13, () => r.int(0, 1000)),
        sym(13),
        matrix(12, () => 5),
        matrix(10, () => r.int(1, 1000)),
        matrix(13, (i, j) => (j === (i + 1) % 13 ? 1 : r.int(50, 1000))),
      ];
    },
    solve: (s) => {
      const [n, ...flat] = nums(s);
      const d = (i: number, j: number) => flat[i * n! + j]!;
      const full = (1 << n!) - 1;
      const INF = 1e9;
      const dp = Array.from({ length: 1 << n! }, () => new Int32Array(n!).fill(INF));
      dp[1]![0] = 0;
      for (let mask = 1; mask <= full; mask += 2)
        for (let last = 0; last < n!; last++) {
          const cur = dp[mask]![last]!;
          if (cur >= INF) continue;
          for (let next = 1; next < n!; next++) {
            if (mask & (1 << next)) continue;
            const nm = mask | (1 << next);
            const cost = cur + d(last, next);
            if (cost < dp[nm]![next]!) dp[nm]![next] = cost;
          }
        }
      let best = INF;
      for (let last = 0; last < n!; last++) best = Math.min(best, dp[full]![last]! + d(last, 0));
      return String(best);
    },
    python: py(`
      import sys
      from functools import lru_cache
      d = sys.stdin.read().split()
      n = int(d[0])
      dist = [[int(d[1 + i * n + j]) for j in range(n)] for i in range(n)]
      full = (1 << n) - 1

      @lru_cache(maxsize=None)
      def rest(mask, last):
          # cheapest way to visit the cities not in mask and return to city 0, standing at 'last'
          if mask == full:
              return dist[last][0]
          return min(dist[last][j] + rest(mask | (1 << j), j) for j in range(n) if not mask & (1 << j))

      print(rest(1, 0))
    `),
  },
  {
    slug: 'weighted-intervals',
    title: 'Best Booking Schedule',
    difficulty: 'HARD',
    timeLimitMs: 2000,
    statement: statement(
      `A conference hall receives \`n\` booking requests. Request \`i\` wants the hall from time \`si\` until time \`ei\` (the hall is free again at time \`ei\`) and would pay \`pi\`. You may accept any set of requests as long as no two accepted requests **overlap**; a request ending at time \`t\` and another starting at time \`t\` do not overlap.

Find the **maximum total payment** you can collect.

For the requests \`(1,3,5)\`, \`(2,5,6)\`, \`(4,6,5)\`, \`(6,7,4)\` the best choice is \`(1,3)\`, \`(4,6)\` and \`(6,7)\` for 5 + 5 + 4 = 14; taking the single most valuable request \`(2,5)\` and then \`(6,7)\` gives only 10. Greedily picking the earliest-ending or highest-paying request does not always work.`,
      'The first line contains `n`. Each of the next `n` lines contains `si ei pi`.',
      'Print the maximum total payment.',
      ['1 ≤ n ≤ 2·10^5', '0 ≤ si < ei ≤ 10^9', '1 ≤ pi ≤ 10^9', 'the total fits in 64 bits'],
    ),
    samples: ['4\n1 3 5\n2 5 6\n4 6 5\n6 7 4\n', '1\n0 1 100\n'],
    hidden: (r) => {
      const build = (jobs: number[][]) => `${jobs.length}\n${pairLines(jobs)}\n`;
      const random = (n: number, span: number, len: number) =>
        range(n, () => {
          const st = r.int(0, span);
          return [st, st + r.int(1, len), r.int(1, 1e9)];
        });
      return [
        build([[5, 9, 12]]),
        build(range(200000, () => [10, 20, r.int(1, 1e9)])),
        build(range(200000, (i) => [i, i + 1, r.int(1, 1e9)])),
        build(random(200000, 900000000, 100000000)),
        build(random(200000, 1000, 40)),
        build([
          ...range(100000, (i) => [2 * i, 2 * i + 2, 10]),
          ...range(100000, (i) => [2 * i, 2 * i + 3, r.int(1, 25)]),
        ]),
      ];
    },
    solve: (s) => {
      const [n, ...rest] = nums(s);
      const jobs = range(n!, (i) => [rest[3 * i]!, rest[3 * i + 1]!, rest[3 * i + 2]!]).sort(
        (x, y) => x[1]! - y[1]!,
      );
      const ends = jobs.map((j) => j[1]!);
      const best = new Float64Array(n! + 1);
      for (let i = 1; i <= n!; i++) {
        const [st, , pay] = jobs[i - 1]!;
        // jobs finishing no later than `st` are all among the first i - 1, since e > s
        let lo = 0;
        let hi = i - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (ends[mid]! <= st!) lo = mid + 1;
          else hi = mid;
        }
        best[i] = Math.max(best[i - 1]!, best[lo]! + pay!);
      }
      return String(best[n!]);
    },
    python: py(`
      import sys
      from bisect import bisect_left
      d = sys.stdin.buffer.read().split()
      n = int(d[0])
      jobs = sorted((int(d[1 + 3 * i]), int(d[2 + 3 * i]), int(d[3 + 3 * i])) for i in range(n))
      starts = [j[0] for j in jobs]
      f = [0] * (n + 1)  # f[i]: best total using only jobs i.. (sorted by start)
      for i in range(n - 1, -1, -1):
          s, e, p = jobs[i]
          nxt = bisect_left(starts, e)
          f[i] = max(f[i + 1], p + f[nxt])
      print(f[0])
    `),
  },
];
