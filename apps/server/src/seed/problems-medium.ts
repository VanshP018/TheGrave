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
import { randomEdges, randomTree, relabel, treeInput } from './problems-gen.js';

const MOD = 1_000_000_007;
const pairLines = (pairs: number[][]) => pairs.map((p) => p.join(' ')).join('\n');
const signed = (r: { int: (a: number, b: number) => number; float: () => number }, max: number) =>
  r.int(1, max) * (r.float() < 0.5 ? -1 : 1);

/** Original medium problems: each has a worked example in the statement, 2 samples and 5-6 hidden tests. */
export const mediumProblems: ProblemDef[] = [
  {
    slug: 'subarray-sum-k',
    title: 'Exact Budget Streaks',
    difficulty: 'MEDIUM',
    statement: statement(
      `A shop records its profit (or loss, if negative) for each of \`n\` consecutive days. A **streak** is a non-empty block of consecutive days. Count the streaks whose total profit is **exactly** \`k\`.

Streaks that cover different days are different even if they have the same total. For example, for profits \`1 2 1 2 1\` and \`k = 3\` the streaks with total 3 are days 1-2, days 2-3, days 3-4 and days 4-5, so the answer is 4. For profits \`0 0 0\` and \`k = 0\` every one of the 6 streaks counts.

Profits can be negative, so you cannot simply grow and shrink a window; think about prefix sums.`,
      'The first line contains `n k`. The second line contains `n` integers `a1 … an`.',
      'Print the number of streaks with total exactly `k`. The answer can exceed 32 bits.',
      ['1 ≤ n ≤ 2·10^5', '|ai| ≤ 10^4', '|k| ≤ 10^9'],
    ),
    samples: ['5 3\n1 2 1 2 1\n', '3 0\n0 0 0\n'],
    hidden: (r) => [
      arrInput([5], [1, 5]),
      arrInput(
        range(200000, () => 0),
        [200000, 0],
      ),
      arrInput(r.ints(200000, -10000, 10000), [200000, r.int(-100000, 100000)]),
      arrInput(r.ints(200000, 0, 1), [200000, 100]),
      arrInput(r.ints(1000, -3, 3), [1000, 0]),
      arrInput(r.ints(200000, 1, 10000), [200000, 1e9]),
    ],
    solve: (s) => {
      const [n, k, ...rest] = nums(s);
      const seen = new Map<number, number>([[0, 1]]);
      let sum = 0;
      let ans = 0;
      for (const x of rest.slice(0, n)) {
        sum += x;
        ans += seen.get(sum - k!) ?? 0;
        seen.set(sum, (seen.get(sum) ?? 0) + 1);
      }
      return String(ans);
    },
    python: py(`
      import sys
      from collections import defaultdict
      d = sys.stdin.buffer.read().split()
      n, k = int(d[0]), int(d[1])
      cnt = defaultdict(int)
      cnt[0] = 1
      s = 0
      ans = 0
      for x in d[2:2 + n]:
          s += int(x)
          ans += cnt[s - k]
          cnt[s] += 1
      print(ans)
    `),
  },
  {
    slug: 'product-except-self',
    title: 'Product of the Others',
    difficulty: 'MEDIUM',
    statement: statement(
      `You are given \`n\` integers. For every position \`i\`, compute the product of **all the other** elements (everything except \`ai\`). The products can be astronomically large, so print each one modulo \`1 000 000 007\`, as a value between 0 and 1 000 000 006 (a negative product \`-x\` is printed as \`1000000007 - x\`).

For \`1 2 3 4\` the answers are \`24 12 8 6\`. For \`2 0 5\` they are \`0 10 0\`: only the position holding the zero has a non-zero product of the others.

Be careful with zeros: dividing the total product by \`ai\` does not work when \`ai = 0\`.`,
      'The first line contains `n`. The second line contains `n` integers `a1 … an`.',
      'Print `n` space-separated integers: the product of all other elements for each position, modulo 1000000007.',
      ['2 ≤ n ≤ 10^5', '|ai| ≤ 1000'],
    ),
    samples: ['4\n1 2 3 4\n', '3\n2 0 5\n'],
    hidden: (r) => [
      arrInput([-7, 3]),
      arrInput(range(10, () => 0)),
      arrInput([0, 3, 0, 5]),
      arrInput([4, -2, 0, 9, 1]),
      arrInput(range(100000, () => signed(r, 1000))),
      arrInput(r.ints(100000, -1000, 1000)),
    ],
    solve: (s) => {
      const [n, ...rest] = nums(s);
      const a = rest.slice(0, n).map((x) => BigInt(x));
      const M = BigInt(MOD);
      const norm = (x: bigint) => ((x % M) + M) % M;
      const pre: bigint[] = [1n];
      for (let i = 0; i < n!; i++) pre.push(norm(pre[i]! * a[i]!));
      const suf: bigint[] = new Array(n! + 1).fill(1n);
      for (let i = n! - 1; i >= 0; i--) suf[i] = norm(suf[i + 1]! * a[i]!);
      return range(n!, (i) => String(norm(pre[i]! * suf[i + 1]!))).join(' ');
    },
    python: py(`
      import sys
      MOD = 10**9 + 7
      d = sys.stdin.read().split()
      n = int(d[0])
      a = list(map(int, d[1:1 + n]))
      zeros = a.count(0)
      p = 1
      for x in a:
          if x: p = p * x % MOD
      out = []
      for x in a:
          if zeros >= 2: out.append(0)
          elif zeros == 1: out.append(p if x == 0 else 0)
          else: out.append(p * pow(x % MOD, MOD - 2, MOD) % MOD)
      print(' '.join(map(str, out)))
    `),
  },
  {
    slug: 'shortest-substring-all-chars',
    title: 'Smallest Complete Window',
    difficulty: 'MEDIUM',
    timeLimitMs: 2000,
    statement: statement(
      `A string \`s\` uses some set of distinct letters. A substring is **complete** if it contains **every distinct letter that occurs in \`s\`** at least once. Find the length of the shortest complete substring.

For \`abcabcbb\` the distinct letters are \`a\`, \`b\`, \`c\`, and the shortest substring containing all three has length 3 (for instance \`abc\`). For \`aabcbcdbca\` the distinct letters are \`a\`, \`b\`, \`c\`, \`d\`; the shortest complete substring is \`dbca\`, so the answer is 4.

Note that the whole string is always complete, so an answer always exists.`,
      'A single line containing a string `s` of lowercase English letters.',
      'Print the length of the shortest complete substring.',
      ['1 ≤ |s| ≤ 2·10^5'],
    ),
    samples: ['abcabcbb\n', 'aabcbcdbca\n'],
    hidden: (r) => [
      'a\n',
      `${'a'.repeat(200000)}\n`,
      `${'a'.repeat(100000)}b${'a'.repeat(99999)}\n`,
      `${'abcdefghijklmnopqrstuvwxyz'.repeat(7000)}\n`,
      `${r.word(50, 'abc')}\n`,
      `${r.word(200000)}\n`,
    ],
    solve: (s) => {
      const t = lines(s)[0]!;
      const need = new Set(t).size;
      const cnt = new Int32Array(26);
      let have = 0;
      let best = t.length;
      let l = 0;
      for (let rIdx = 0; rIdx < t.length; rIdx++) {
        if (cnt[t.charCodeAt(rIdx) - 97]!++ === 0) have++;
        while (have === need) {
          best = Math.min(best, rIdx - l + 1);
          if (--cnt[t.charCodeAt(l) - 97]! === 0) have--;
          l++;
        }
      }
      return String(best);
    },
    python: py(`
      s = input().strip()
      need = len(set(s))
      last = {}
      best = len(s)
      for i, c in enumerate(s):
          last[c] = i
          if len(last) == need:
              best = min(best, i - min(last.values()) + 1)
      print(best)
    `),
  },
  {
    slug: 'meeting-rooms-min',
    title: 'Fewest Meeting Rooms',
    difficulty: 'MEDIUM',
    statement: statement(
      `A company has \`n\` meetings. Meeting \`i\` occupies a room from time \`si\` up to (but not including) time \`ei\`. Two meetings can use the **same room** if one ends no later than the other starts: a meeting ending at time 5 and another starting at time 5 do not conflict.

Find the **minimum number of rooms** needed so that every meeting gets a room for its whole duration.

For meetings \`[0,30)\`, \`[5,10)\`, \`[15,20)\` the first meeting runs the whole time, and the other two never overlap each other but both overlap it, so 2 rooms are enough. For \`[1,5)\` and \`[5,9)\` a single room suffices.`,
      'The first line contains `n`. Each of the next `n` lines contains `si ei`.',
      'Print the minimum number of rooms.',
      ['1 ≤ n ≤ 2·10^5', '0 ≤ si < ei ≤ 10^9'],
    ),
    samples: ['3\n0 30\n5 10\n15 20\n', '2\n1 5\n5 9\n'],
    hidden: (r) => {
      const random = (n: number, span: number, len: number) =>
        range(n, () => {
          const s = r.int(0, span);
          return [s, s + r.int(1, len)];
        });
      return [
        '1\n3 4\n',
        `1000\n${pairLines(range(1000, () => [0, 10]))}\n`,
        `200000\n${pairLines(range(200000, (i) => [i, i + 1]))}\n`,
        `200000\n${pairLines(random(200000, 900000000, 100000000))}\n`,
        `200000\n${pairLines(random(200000, 1000, 50))}\n`,
        `200000\n${pairLines(range(200000, (i) => [i, 1e9 - i]))}\n`,
      ];
    },
    solve: (s) => {
      const [n, ...rest] = nums(s);
      const starts = range(n!, (i) => rest[2 * i]!).sort((x, y) => x - y);
      const ends = range(n!, (i) => rest[2 * i + 1]!).sort((x, y) => x - y);
      let rooms = 0;
      let j = 0;
      for (const st of starts) {
        if (st >= ends[j]!) j++;
        else rooms++;
      }
      return String(rooms);
    },
    python: py(`
      import sys, heapq
      d = sys.stdin.buffer.read().split()
      n = int(d[0])
      iv = sorted((int(d[1 + 2 * i]), int(d[2 + 2 * i])) for i in range(n))
      h = []
      for s, e in iv:
          if h and h[0] <= s:
              heapq.heapreplace(h, e)
          else:
              heapq.heappush(h, e)
      print(len(h))
    `),
  },
  {
    slug: 'search-rotated-array',
    title: 'Find in the Rotated Shelf',
    difficulty: 'MEDIUM',
    statement: statement(
      `A shelf holds \`n\` **distinct** book numbers that were arranged in increasing order and then rotated: the last \`k\` books (for some unknown \`k\`, possibly 0) were moved to the front without changing their relative order. For example, \`4 5 6 7 0 1 2\` is the sorted shelf \`0 1 2 4 5 6 7\` after its last 3 books (\`0 1 2\`) were moved to the front.

You are given the shelf and \`q\` queries. For each query value, print the **0-based position** of that book on the shelf, or \`-1\` if it is not there.

For the shelf \`4 5 6 7 0 1 2\`: the book 0 is at position 4, the book 3 is missing (\`-1\`) and the book 6 is at position 2. A linear scan per query is too slow for the largest inputs; the shelf is nearly sorted, so use that.`,
      'The first line contains `n q`. The second line contains the `n` shelf numbers. The third line contains the `q` queried values.',
      'Print `q` lines: the position of each queried value, or -1.',
      ['1 ≤ n, q ≤ 10^5', 'all shelf numbers are distinct', '0 ≤ values ≤ 10^9'],
    ),
    samples: ['7 3\n4 5 6 7 0 1 2\n0 3 6\n', '1 2\n5\n5 6\n'],
    hidden: (r) => {
      const shelf = (n: number, k: number) => {
        const base = range(n, (i) => i * 7 + r.int(0, 6));
        return [...base.slice(k), ...base.slice(0, k)];
      };
      const build = (a: number[], q: number) => {
        const queries = range(q, () => (r.float() < 0.5 ? r.pick(a) : r.int(0, a.length * 7 + 7)));
        return `${a.length} ${q}\n${a.join(' ')}\n${queries.join(' ')}\n`;
      };
      return [
        build(shelf(1, 0), 5),
        build(shelf(2, 1), 6),
        build(shelf(50, 17), 100),
        build(shelf(100000, 0), 100000),
        build(shelf(100000, r.int(1, 99999)), 100000),
        build(shelf(100000, 99999), 100000),
      ];
    },
    solve: (s) => {
      const [n, q, ...rest] = nums(s);
      const a = rest.slice(0, n);
      const find = (x: number) => {
        let lo = 0;
        let hi = n! - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (a[mid] === x) return mid;
          if (a[lo]! <= a[mid]!) {
            if (a[lo]! <= x && x < a[mid]!) hi = mid - 1;
            else lo = mid + 1;
          } else if (a[mid]! < x && x <= a[hi]!) lo = mid + 1;
          else hi = mid - 1;
        }
        return -1;
      };
      return rest
        .slice(n!, n! + q!)
        .map(find)
        .join('\n');
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      n, q = int(d[0]), int(d[1])
      pos = {int(x): i for i, x in enumerate(d[2:2 + n])}
      print('\\n'.join(str(pos.get(int(x), -1)) for x in d[2 + n:2 + n + q]))
    `),
  },
  {
    slug: 'ship-capacity',
    title: 'Shipping Within Deadline',
    difficulty: 'MEDIUM',
    statement: statement(
      `A cargo ship must deliver \`n\` packages, which wait on a conveyor in a fixed order; package \`i\` weighs \`wi\`. Every day the ship loads packages **in conveyor order** (it may not skip or reorder packages), taking as many consecutive packages as it can without the total load exceeding its **capacity**, and sails. All packages must be shipped within \`D\` days.

Find the **smallest capacity** that makes this possible.

For weights \`1 2 3 4 5 6 7 8 9 10\` and \`D = 5\` the answer is 15: with capacity 15 the days carry \`1 2 3 4 5\`, \`6 7\`, \`8\`, \`9\`, \`10\`; with capacity 14 you would need six days. A capacity must at least cover the heaviest package, and a capacity equal to the total weight always works.`,
      'The first line contains `n D`. The second line contains `n` integers `w1 … wn`.',
      'Print the minimum capacity.',
      ['1 ≤ D ≤ n ≤ 10^5', '1 ≤ wi ≤ 10^4'],
    ),
    samples: ['10 5\n1 2 3 4 5 6 7 8 9 10\n', '3 3\n1 2 3\n'],
    hidden: (r) => [
      arrInput(r.ints(100000, 1, 10000), [100000, 1]),
      arrInput(r.ints(100000, 1, 10000), [100000, 100000]),
      arrInput(r.ints(100000, 1, 10000), [100000, r.int(1, 100000)]),
      arrInput(
        range(100000, () => 500),
        [100000, 777],
      ),
      arrInput([1, 1, 10000, 1, 1], [5, 2]),
      arrInput(r.ints(20, 1, 30), [20, 6]),
    ],
    solve: (s) => {
      const [n, days, ...rest] = nums(s);
      const w = rest.slice(0, n);
      let lo = Math.max(...w);
      let hi = w.reduce((x, y) => x + y, 0);
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        let used = 1;
        let cur = 0;
        for (const x of w) {
          if (cur + x > mid) {
            used++;
            cur = x;
          } else cur += x;
        }
        if (used <= days!) hi = mid;
        else lo = mid + 1;
      }
      return String(lo);
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      n, D = int(d[0]), int(d[1])
      w = list(map(int, d[2:2 + n]))

      def days_needed(cap):
          days, cur = 1, 0
          for x in w:
              if cur + x > cap:
                  days += 1
                  cur = 0
              cur += x
          return days

      lo, hi, ans = max(w), sum(w), sum(w)
      while lo <= hi:
          mid = (lo + hi) // 2
          if days_needed(mid) <= D:
              ans = mid
              hi = mid - 1
          else:
              lo = mid + 1
      print(ans)
    `),
  },
  {
    slug: 'min-jumps',
    title: 'Frog on the Lily Pads',
    difficulty: 'MEDIUM',
    statement: statement(
      `A frog sits on lily pad 1 of a row of \`n\` pads. From pad \`i\` it can jump forward to **any** pad between \`i + 1\` and \`i + ai\` (it cannot jump backwards, and \`ai = 0\` means the frog is stuck on that pad). The frog wants to reach pad \`n\` with as **few jumps** as possible.

For \`2 3 1 1 4\` the answer is 2: jump from pad 1 to pad 2, then from pad 2 to pad 5. For \`1 0 5\` the frog can reach pad 2 but is stuck there, so the answer is \`-1\`.

If \`n = 1\` the frog is already at the goal and the answer is 0.`,
      'The first line contains `n`. The second line contains `n` integers `a1 … an`.',
      'Print the minimum number of jumps, or -1 if pad `n` cannot be reached.',
      ['1 ≤ n ≤ 2·10^5', '0 ≤ ai ≤ 10^5'],
    ),
    samples: ['5\n2 3 1 1 4\n', '3\n1 0 5\n'],
    hidden: (r) => [
      arrInput([0]),
      arrInput(range(200000, () => 1)),
      arrInput(range(200000, (i) => (i === 10 ? 0 : 1))),
      arrInput(r.ints(200000, 0, 3)),
      arrInput(r.ints(200000, 1, 1000)),
      arrInput(r.ints(200000, 1, 5)),
    ],
    solve: (s) => {
      const [n, ...rest] = nums(s);
      const a = rest.slice(0, n);
      let jumps = 0;
      let curEnd = 0;
      let far = 0;
      for (let i = 0; i < n! - 1; i++) {
        far = Math.max(far, i + a[i]!);
        if (i === curEnd) {
          if (far <= i) return '-1';
          jumps++;
          curEnd = far;
          if (curEnd >= n! - 1) break;
        }
      }
      return String(jumps);
    },
    python: py(`
      import sys
      from collections import deque
      d = sys.stdin.buffer.read().split()
      n = int(d[0])
      a = list(map(int, d[1:1 + n]))
      dist = [-1] * n
      dist[0] = 0
      q = deque([0])
      far = 0
      while q:
          u = q.popleft()
          hi = min(n - 1, u + a[u])
          for v in range(far + 1, hi + 1):
              dist[v] = dist[u] + 1
              q.append(v)
          if hi > far:
              far = hi
      print(dist[n - 1])
    `),
  },
  {
    slug: 'provinces-count',
    title: 'Count the Kingdoms',
    difficulty: 'MEDIUM',
    statement: statement(
      `A continent has \`n\` towns numbered 1 to \`n\` and \`m\` two-way roads. Two towns belong to the same **kingdom** if you can travel from one to the other along roads, possibly through other towns. A town with no roads is a kingdom of its own.

Count the kingdoms. For example, with 5 towns and the roads \`1-2\`, \`2-3\` and \`4-5\` there are 2 kingdoms (\`{1,2,3}\` and \`{4,5}\`). With 3 towns and no roads there are 3.

Several roads may connect the same pair of towns, but no road connects a town to itself.`,
      'The first line contains `n m`. Each of the next `m` lines contains two towns `u v` joined by a road.',
      'Print the number of kingdoms.',
      ['1 ≤ n ≤ 2·10^5', '0 ≤ m ≤ 2·10^5', '1 ≤ u, v ≤ n, u ≠ v'],
    ),
    samples: ['5 3\n1 2\n2 3\n4 5\n', '3 0\n'],
    hidden: (r) => [
      edgeInput(1, []),
      edgeInput(200000, []),
      edgeInput(
        200000,
        range(199999, (i) => [i + 1, i + 2]),
      ),
      edgeInput(200000, randomEdges(r, 200000, 200000)),
      edgeInput(1000, randomEdges(r, 1000, 300)),
      edgeInput(
        100000,
        range(99999, (i) => [1, i + 2]),
      ),
    ],
    solve: (s) => {
      const [n, m, ...rest] = nums(s);
      const parent = range(n! + 1, (i) => i);
      const find = (x: number) => {
        while (parent[x] !== x) {
          parent[x] = parent[parent[x]!]!;
          x = parent[x]!;
        }
        return x;
      };
      let comps = n!;
      for (let i = 0; i < m!; i++) {
        const a = find(rest[2 * i]!);
        const b = find(rest[2 * i + 1]!);
        if (a !== b) {
          parent[a] = b;
          comps--;
        }
      }
      return String(comps);
    },
    python: py(`
      import sys
      from collections import deque
      d = sys.stdin.buffer.read().split()
      n, m = int(d[0]), int(d[1])
      adj = [[] for _ in range(n + 1)]
      for i in range(m):
          u, v = int(d[2 + 2 * i]), int(d[3 + 2 * i])
          adj[u].append(v)
          adj[v].append(u)
      seen = [False] * (n + 1)
      comps = 0
      for s in range(1, n + 1):
          if seen[s]:
              continue
          comps += 1
          seen[s] = True
          q = deque([s])
          while q:
              u = q.popleft()
              for v in adj[u]:
                  if not seen[v]:
                      seen[v] = True
                      q.append(v)
      print(comps)
    `),
  },
  {
    slug: 'bipartite-check',
    title: 'Two Teams, No Rivals',
    difficulty: 'MEDIUM',
    statement: statement(
      `There are \`n\` players and \`m\` pairs of rivals. The coach wants to split all players into **two teams** (a team may be empty) so that no two rivals end up on the **same** team.

Decide whether that is possible. For a ring of 4 players where each is a rival of the next (\`1-2\`, \`2-3\`, \`3-4\`, \`4-1\`) it is: put players 1 and 3 on one team and 2 and 4 on the other. For three players who are all rivals of each other (\`1-2\`, \`2-3\`, \`3-1\`) it is impossible, since among any three players two share a team.

The rivalry graph may be disconnected, and the same pair may be listed more than once.`,
      'The first line contains `n m`. Each of the next `m` lines contains a rival pair `u v`.',
      'Print `YES` if a valid split exists, otherwise `NO`.',
      ['1 ≤ n ≤ 2·10^5', '0 ≤ m ≤ 2·10^5', '1 ≤ u, v ≤ n, u ≠ v'],
    ),
    samples: ['4 4\n1 2\n2 3\n3 4\n4 1\n', '3 3\n1 2\n2 3\n3 1\n'],
    hidden: (r) => {
      const cycle = (n: number) => range(n, (i) => [i + 1, ((i + 1) % n) + 1]);
      return [
        edgeInput(200000, relabel(r, 200000, randomTree(r, 200000))),
        edgeInput(200000, cycle(200000)),
        edgeInput(199999, cycle(199999)),
        edgeInput(1000, randomEdges(r, 1000, 1500)),
        edgeInput(100010, [
          ...cycle(100000),
          ...randomTree(r, 10).map(([a, b]) => [a! + 100000, b! + 100000]),
        ]),
        edgeInput(5, []),
      ];
    },
    solve: (s) => {
      const [n, m, ...rest] = nums(s);
      const adj: number[][] = range(n! + 1, () => []);
      for (let i = 0; i < m!; i++) {
        const u = rest[2 * i]!;
        const v = rest[2 * i + 1]!;
        adj[u]!.push(v);
        adj[v]!.push(u);
      }
      const color = new Int8Array(n! + 1).fill(-1);
      for (let s0 = 1; s0 <= n!; s0++) {
        if (color[s0] !== -1) continue;
        color[s0] = 0;
        const queue = [s0];
        for (let h = 0; h < queue.length; h++) {
          const u = queue[h]!;
          for (const v of adj[u]!) {
            if (color[v] === -1) {
              color[v] = (1 - color[u]!) as 0 | 1;
              queue.push(v);
            } else if (color[v] === color[u]) return 'NO';
          }
        }
      }
      return 'YES';
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      n, m = int(d[0]), int(d[1])
      # every player i has two copies: i (team A) and i + n (team B); a rivalry forces opposite copies together
      p = list(range(2 * n + 2))

      def find(x):
          while p[x] != x:
              p[x] = p[p[x]]
              x = p[x]
          return x

      for i in range(m):
          u, v = int(d[2 + 2 * i]), int(d[3 + 2 * i])
          p[find(u)] = find(v + n)
          p[find(u + n)] = find(v)
      print('NO' if any(find(i) == find(i + n) for i in range(1, n + 1)) else 'YES')
    `),
  },
  {
    slug: 'word-break-count',
    title: 'Ways to Spell It Out',
    difficulty: 'MEDIUM',
    timeLimitMs: 2000,
    statement: statement(
      `You have a dictionary of \`k\` distinct words and a long string \`s\`. A **segmentation** of \`s\` cuts it into consecutive pieces so that **every piece is a dictionary word**; a word may be used any number of times. Two segmentations are different if they cut \`s\` at different places.

Count the segmentations, modulo \`1 000 000 007\`.

With the dictionary \`a, aa, aaa\` and \`s = aaaa\` there are 7 segmentations (every way to write 4 as an ordered sum of 1s, 2s and 3s). With the dictionary \`ab, abc\` and \`s = abcab\` the only segmentation is \`abc | ab\`, so the answer is 1. If \`s\` cannot be segmented at all, print 0.`,
      'The first line contains `k`. The next `k` lines each contain one dictionary word. The last line contains the string `s`. All characters are lowercase letters.',
      'Print the number of segmentations modulo 1000000007.',
      [
        '1 ≤ k ≤ 200',
        'each word has length between 1 and 20, and all words are distinct',
        '1 ≤ |s| ≤ 2000',
      ],
    ),
    samples: ['3\na\naa\naaa\naaaa\n', '2\nab\nabc\nabcab\n'],
    hidden: (r) => {
      const dictionary = (k: number, maxLen: number, alphabet: string) => {
        const words = new Set<string>();
        for (let t = 0; t < 10 * k && words.size < k; t++)
          words.add(r.word(r.int(1, maxLen), alphabet));
        return [...words];
      };
      const text = (words: string[], limit: number) => {
        let out = '';
        for (;;) {
          const w = r.pick(words);
          if (out.length + w.length > limit) return out || w;
          out += w;
        }
      };
      const build = (words: string[], str: string) =>
        `${words.length}\n${words.join('\n')}\n${str}\n`;
      const small = dictionary(100, 4, 'ab');
      const wide = dictionary(200, 6, 'abc');
      return [
        build(
          range(10, (i) => 'a'.repeat(i + 1)),
          'a'.repeat(2000),
        ),
        build(small, text(small, 2000)),
        build(['a', 'b'], 'c'.repeat(10)),
        build(wide, text(wide, 2000)),
        build(['abab', 'ab'], 'ab'.repeat(1000)),
        build(small, r.word(2000, 'ab')),
      ];
    },
    solve: (s) => {
      const ls = lines(s);
      const k = Number(ls[0]);
      const words = ls.slice(1, 1 + k);
      const str = ls[1 + k]!;
      const n = str.length;
      const ways = new Array<number>(n + 1).fill(0);
      ways[n] = 1;
      for (let i = n - 1; i >= 0; i--) {
        let total = 0;
        for (const w of words) if (str.startsWith(w, i)) total += ways[i + w.length]!;
        ways[i] = total % MOD;
      }
      return String(ways[0]);
    },
    python: py(`
      import sys
      MOD = 10**9 + 7
      ls = sys.stdin.read().split('\\n')
      k = int(ls[0])
      words = ls[1:1 + k]
      s = ls[1 + k].strip()
      n = len(s)
      dp = [0] * (n + 1)
      dp[0] = 1
      for i in range(n):
          if dp[i]:
              for w in words:
                  if s.startswith(w, i):
                      j = i + len(w)
                      dp[j] = (dp[j] + dp[i]) % MOD
      print(dp[n])
    `),
  },
  {
    slug: 'house-robber-circular',
    title: 'Robbery on a Round Street',
    difficulty: 'MEDIUM',
    statement: statement(
      `The \`n\` houses of a round street stand in a circle, so house \`n\` is next to house 1 (and, as usual, house \`i\` is next to houses \`i - 1\` and \`i + 1\`). House \`i\` contains \`ai\` coins. A thief may take the coins from any set of houses as long as **no two chosen houses are neighbours**, otherwise the alarm rings. A street with a single house has no neighbours.

Find the maximum number of coins the thief can take.

For houses \`2 3 2 9\` the answer is 12: take house 2 (3 coins) and house 4 (9 coins), which are not neighbours. Taking houses 1 and 3 gives only 4, and houses 1 and 4 are neighbours because the street is a circle.`,
      'The first line contains `n`. The second line contains `n` integers `a1 … an`.',
      'Print the maximum number of coins.',
      ['1 ≤ n ≤ 2·10^5', '0 ≤ ai ≤ 10^4'],
    ),
    samples: ['4\n2 3 2 9\n', '1\n5\n'],
    hidden: (r) => [
      arrInput([3, 9]),
      arrInput([7, 1, 7]),
      arrInput(range(200000, () => 4)),
      arrInput(r.ints(200000, 0, 10000)),
      arrInput(r.ints(200000, 0, 1)),
      arrInput(r.ints(15, 0, 20)),
    ],
    solve: (s) => {
      const [n, ...rest] = nums(s);
      const a = rest.slice(0, n);
      if (n === 1) return String(a[0]);
      const line = (arr: number[]) => {
        let take = 0;
        let skip = 0;
        for (const x of arr) [take, skip] = [skip + x, Math.max(take, skip)];
        return Math.max(take, skip);
      };
      return String(Math.max(line(a.slice(0, n! - 1)), line(a.slice(1))));
    },
    python: py(`
      import sys
      d = sys.stdin.read().split()
      n = int(d[0])
      a = list(map(int, d[1:1 + n]))
      NEG = float('-inf')
      best = a[0] if n == 1 else 0
      if n > 1:
          for first in (0, 1):
              no, yes = (NEG, a[0]) if first else (0, NEG)
              for i in range(1, n):
                  take = no + a[i] if not (first and i == n - 1) else NEG
                  no, yes = max(no, yes), take
              best = max(best, no, yes)
      print(int(best))
    `),
  },
  {
    slug: 'partition-equal-subset',
    title: 'Fair Split of the Loot',
    difficulty: 'MEDIUM',
    statement: statement(
      `Two friends found \`n\` items, item \`i\` worth \`ai\` coins. They want to divide **all** the items between them so that both get exactly the same total value. Items cannot be cut, and each item goes to exactly one friend.

Decide whether a fair split exists. For values \`1 5 11 5\` it does: one friend takes \`11\`, the other takes \`1 + 5 + 5\`, and both get 11. For \`1 2 5\` it does not.

(A split where one friend gets nothing is fair only if the total value is 0, which cannot happen here because every value is positive.)`,
      'The first line contains `n`. The second line contains `n` integers `a1 … an`.',
      'Print `YES` if a fair split exists, otherwise `NO`.',
      ['1 ≤ n ≤ 200', '1 ≤ ai ≤ 100'],
    ),
    samples: ['4\n1 5 11 5\n', '3\n1 2 5\n'],
    hidden: (r) => [
      arrInput([42]),
      arrInput([3, 3, 3, 4, 5]),
      arrInput(r.ints(200, 1, 100)),
      arrInput(range(200, () => 100)),
      arrInput(range(99, () => 7)),
      arrInput([...range(199, () => 2), 4]),
    ],
    solve: (s) => {
      const [n, ...rest] = nums(s);
      const a = rest.slice(0, n);
      const total = a.reduce((x, y) => x + y, 0);
      if (total % 2) return 'NO';
      const half = total / 2;
      const can = new Uint8Array(half + 1);
      can[0] = 1;
      for (const x of a) for (let t = half; t >= x; t--) if (can[t - x]) can[t] = 1;
      return can[half] ? 'YES' : 'NO';
    },
    python: py(`
      import sys
      d = sys.stdin.read().split()
      n = int(d[0])
      a = list(map(int, d[1:1 + n]))
      total = sum(a)
      bits = 1
      for x in a:
          bits |= bits << x
      print('YES' if total % 2 == 0 and (bits >> (total // 2)) & 1 else 'NO')
    `),
  },
  {
    slug: 'top-k-frequent',
    title: 'Most Popular Songs',
    difficulty: 'MEDIUM',
    statement: statement(
      `A music app logs the ID of every song played, \`n\` plays in total. Print the \`k\` **most frequently played** song IDs.

List them from the most played to the least played. If two songs were played the same number of times, the one with the **smaller ID** comes first. It is guaranteed that \`k\` does not exceed the number of distinct songs in the log.

For the log \`1 1 1 2 2 3 4 4\` and \`k = 2\` the play counts are 1:3, 2:2, 4:2, 3:1. Songs 2 and 4 tie, and 2 has the smaller ID, so the answer is \`1 2\`. For \`5 5 7 7 9\` and \`k = 3\` the answer is \`5 7 9\`.`,
      'The first line contains `n k`. The second line contains `n` integers, the played IDs.',
      'Print `k` space-separated IDs in the order described above.',
      ['1 ≤ k ≤ (number of distinct IDs) ≤ n ≤ 2·10^5', '|ID| ≤ 10^9'],
    ),
    samples: ['8 2\n1 1 1 2 2 3 4 4\n', '5 3\n5 5 7 7 9\n'],
    hidden: (r) => {
      const build = (a: number[], k: number) =>
        arrInput(a, [a.length, Math.min(k, new Set(a).size)]);
      return [
        build([-8], 1),
        build(r.shuffle(range(200000, (i) => i * 5 - 400000)), 5),
        build(r.ints(200000, 0, 50), 10),
        build(r.ints(200000, 0, 100000), 100),
        build(r.ints(200000, -3, 3), 7),
        build(r.ints(200000, -1e9, 1e9), 50),
      ];
    },
    solve: (s) => {
      const [n, k, ...rest] = nums(s);
      const count = new Map<number, number>();
      for (const x of rest.slice(0, n)) count.set(x, (count.get(x) ?? 0) + 1);
      return [...count.entries()]
        .sort((p, q) => q[1] - p[1] || p[0] - q[0])
        .slice(0, k)
        .map((e) => e[0])
        .join(' ');
    },
    python: py(`
      import sys, heapq
      from collections import Counter
      d = sys.stdin.buffer.read().split()
      n, k = int(d[0]), int(d[1])
      c = Counter(map(int, d[2:2 + n]))
      top = heapq.nsmallest(k, c.items(), key=lambda kv: (-kv[1], kv[0]))
      print(' '.join(str(v) for v, _ in top))
    `),
  },
  {
    slug: 'tree-diameter',
    title: 'Longest Trail in the Network',
    difficulty: 'MEDIUM',
    statement: statement(
      `A network of \`n\` computers is connected by \`n - 1\` cables so that there is exactly one route between any two computers (a **tree**). The **diameter** of the network is the number of cables on the **longest** route between two computers, where a route never visits the same computer twice.

For the cables \`1-2\`, \`2-3\`, \`3-4\`, \`2-5\` the longest routes are \`1-2-3-4\` and \`5-2-3-4\`, each using 3 cables, so the diameter is 3. A network with a single computer has diameter 0.`,
      'The first line contains `n`. Each of the next `n - 1` lines contains two computers `u v` joined by a cable.',
      'Print the diameter (the number of cables on the longest route).',
      ['1 ≤ n ≤ 2·10^5', 'the cables form a tree'],
    ),
    samples: ['5\n1 2\n2 3\n3 4\n2 5\n', '1\n'],
    hidden: (r) => [
      treeInput(2, [[2, 1]]),
      treeInput(
        200000,
        relabel(
          r,
          200000,
          range(199999, (i) => [i + 1, i + 2]),
        ),
      ),
      treeInput(
        200000,
        range(199999, (i) => [1, i + 2]),
      ),
      treeInput(200000, relabel(r, 200000, randomTree(r, 200000))),
      treeInput(200000, relabel(r, 200000, randomTree(r, 200000, 3))),
      treeInput(1000, relabel(r, 1000, randomTree(r, 1000, 10))),
    ],
    solve: (s) => {
      const [n, ...rest] = nums(s);
      const adj: number[][] = range(n! + 1, () => []);
      for (let i = 0; i < n! - 1; i++) {
        adj[rest[2 * i]!]!.push(rest[2 * i + 1]!);
        adj[rest[2 * i + 1]!]!.push(rest[2 * i]!);
      }
      const bfs = (src: number) => {
        const dist = new Int32Array(n! + 1).fill(-1);
        dist[src] = 0;
        const queue = [src];
        let last = src;
        for (let h = 0; h < queue.length; h++) {
          const u = queue[h]!;
          last = u;
          for (const v of adj[u]!)
            if (dist[v] === -1) {
              dist[v] = dist[u]! + 1;
              queue.push(v);
            }
        }
        return { far: last, d: dist[last]! };
      };
      return String(bfs(bfs(1).far).d);
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      n = int(d[0])
      adj = [[] for _ in range(n + 1)]
      for i in range(n - 1):
          u, v = int(d[1 + 2 * i]), int(d[2 + 2 * i])
          adj[u].append(v)
          adj[v].append(u)
      parent = [0] * (n + 1)
      order = [1]
      parent[1] = -1
      for u in order:
          for v in adj[u]:
              if v != parent[u]:
                  parent[v] = u
                  order.append(v)
      height = [0] * (n + 1)
      best = 0
      for v in reversed(order):
          p = parent[v]
          if p > 0:
              cand = height[v] + 1
              best = max(best, height[p] + cand)
              height[p] = max(height[p], cand)
      print(best)
    `),
  },
  {
    slug: 'lca-queries',
    title: 'Common Ancestors',
    difficulty: 'MEDIUM',
    timeLimitMs: 2000,
    statement: statement(
      `A family tree has \`n\` people numbered 1 to \`n\`, with person **1** as the root ancestor; the \`n - 1\` given links join a parent and a child, but you are **not told which is which** (the root is person 1, so orientation follows from that).

The **lowest common ancestor** (LCA) of two people \`u\` and \`v\` is the deepest person who is an ancestor of both. A person counts as their own ancestor, so the LCA of \`u\` and \`u\` is \`u\`, and the LCA of a person and one of their descendants is that person.

For the tree with links \`1-2, 1-3, 2-4, 2-5\`: the LCA of 4 and 5 is 2, the LCA of 4 and 3 is 1, and the LCA of 2 and 2 is 2. Answer \`q\` such queries.`,
      'The first line contains `n q`. The next `n - 1` lines contain the links `u v`. The next `q` lines each contain a query `u v`.',
      'Print `q` lines, the LCA of each query pair.',
      ['1 ≤ n, q ≤ 5·10^4', 'the links form a tree rooted at person 1'],
    ),
    samples: ['5 3\n1 2\n1 3\n2 4\n2 5\n4 5\n4 3\n2 2\n', '1 1\n1 1\n'],
    hidden: (r) => {
      const build = (n: number, q: number, edges: number[][]) =>
        `${n} ${q}\n${pairLines(edges)}${edges.length ? '\n' : ''}${pairLines(
          range(q, () => [r.int(1, n), r.int(1, n)]),
        )}\n`;
      return [
        build(
          50000,
          50000,
          range(49999, (i) => [i + 1, i + 2]),
        ),
        build(
          50000,
          50000,
          range(49999, (i) => [1, i + 2]),
        ),
        build(50000, 50000, randomTree(r, 50000)),
        build(
          50000,
          50000,
          range(49999, (i) => [Math.floor((i + 2) / 2), i + 2]),
        ),
        build(50000, 50000, relabelKeepRoot(r, 50000, randomTree(r, 50000, 5))),
        build(2, 6, [[2, 1]]),
      ];
    },
    solve: (s) => {
      const [n, q, ...rest] = nums(s);
      const adj: number[][] = range(n! + 1, () => []);
      for (let i = 0; i < n! - 1; i++) {
        adj[rest[2 * i]!]!.push(rest[2 * i + 1]!);
        adj[rest[2 * i + 1]!]!.push(rest[2 * i]!);
      }
      const LOG = 17;
      const up: Int32Array[] = range(LOG, () => new Int32Array(n! + 1));
      const depth = new Int32Array(n! + 1);
      const order = [1];
      up[0]![1] = 0;
      for (let h = 0; h < order.length; h++) {
        const u = order[h]!;
        for (const v of adj[u]!)
          if (v !== up[0]![u]) {
            up[0]![v] = u;
            depth[v] = depth[u]! + 1;
            order.push(v);
          }
      }
      for (let j = 1; j < LOG; j++)
        for (let v = 1; v <= n!; v++) up[j]![v] = up[j - 1]![up[j - 1]![v]!]!;
      const out: number[] = [];
      const base = 2 * (n! - 1);
      for (let i = 0; i < q!; i++) {
        let u = rest[base + 2 * i]!;
        let v = rest[base + 2 * i + 1]!;
        if (depth[u]! < depth[v]!) [u, v] = [v, u];
        let diff = depth[u]! - depth[v]!;
        for (let j = 0; diff; j++, diff >>= 1) if (diff & 1) u = up[j]![u]!;
        if (u !== v) {
          for (let j = LOG - 1; j >= 0; j--)
            if (up[j]![u] !== up[j]![v]) {
              u = up[j]![u]!;
              v = up[j]![v]!;
            }
          u = up[0]![u]!;
        }
        out.push(u);
      }
      return out.join('\n');
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      n, q = int(d[0]), int(d[1])
      adj = [[] for _ in range(n + 1)]
      for i in range(n - 1):
          u, v = int(d[2 + 2 * i]), int(d[3 + 2 * i])
          adj[u].append(v)
          adj[v].append(u)
      parent = [0] * (n + 1)
      depth = [0] * (n + 1)
      tin = [0] * (n + 1)
      order = []
      stack = [1]
      while stack:
          u = stack.pop()
          tin[u] = len(order)
          order.append(u)
          for v in adj[u]:
              if v != parent[u]:
                  parent[v] = u
                  depth[v] = depth[u] + 1
                  stack.append(v)
      # LCA(u, v) for tin[u] < tin[v] is the parent of the shallowest vertex with tin in (tin[u], tin[v]]
      N = n + 1
      key = [depth[v] * N + v for v in order]
      table = [key]
      j = 1
      while (1 << j) <= n:
          prev = table[-1]
          half = 1 << (j - 1)
          table.append([min(prev[i], prev[i + half]) for i in range(n - (1 << j) + 1)])
          j += 1
      out = []
      base = 2 + 2 * (n - 1)
      for i in range(q):
          u, v = int(d[base + 2 * i]), int(d[base + 2 * i + 1])
          if u == v:
              out.append(u)
              continue
          a, b = tin[u], tin[v]
          if a > b:
              a, b = b, a
          a += 1
          k = (b - a + 1).bit_length() - 1
          best = min(table[k][a], table[k][b - (1 << k) + 1])
          out.append(parent[best % N])
      print('\\n'.join(map(str, out)))
    `),
  },
  {
    slug: 'gas-station',
    title: 'Fuel Stop Circuit',
    difficulty: 'MEDIUM',
    statement: statement(
      `A circular road has \`n\` fuel stations numbered 0 to \`n - 1\`. Station \`i\` sells you \`gi\` litres of fuel when you arrive, and driving from station \`i\` to the next one (station \`i + 1\`, with station \`n - 1\` followed by station 0) costs \`ci\` litres. You start at a station of your choice with an **empty** tank, collect that station's fuel, and drive **clockwise** (increasing index) around the whole circle once, collecting fuel at every station you reach. The tank may never go below 0 while driving.

Find the **smallest starting index** from which you can complete the full circle and return to your start, or -1 if no starting station works.

For \`g = 1 2 3 4 5\` and \`c = 3 4 5 1 2\` the answer is 3. Starting at station 3 the tank reads 4, then 3 after the first leg; at station 4 you collect 5 (8), pay 2 (6); at station 0 collect 1 (7), pay 3 (4); at station 1 collect 2 (6), pay 4 (2); at station 2 collect 3 (5), pay 5 (0). The tank never goes below 0, so the circle is complete. Starting at stations 0, 1 or 2 runs out of fuel on the very first leg, and station 4 fails later.`,
      'The first line contains `n`. The second line contains `g0 … g(n-1)`. The third line contains `c0 … c(n-1)`.',
      'Print the smallest valid starting index, or -1.',
      ['1 ≤ n ≤ 2·10^5', '0 ≤ gi, ci ≤ 10^4'],
    ),
    samples: ['5\n1 2 3 4 5\n3 4 5 1 2\n', '3\n2 3 4\n3 4 3\n'],
    hidden: (r) => {
      const build = (g: number[], c: number[]) => `${g.length}\n${g.join(' ')}\n${c.join(' ')}\n`;
      const circuit = (n: number, feasible: boolean) => {
        const c = r.ints(n, 0, 1000);
        const g = c.map((x) => Math.max(0, x + r.int(-50, 50)));
        const gap = g.reduce((x, y) => x + y, 0) - c.reduce((x, y) => x + y, 0);
        const i = r.int(0, n - 1);
        if (feasible && gap < 0) g[i] = g[i]! - gap;
        if (!feasible && gap >= 0) c[i] = c[i]! + gap + 1;
        return build(g, c);
      };
      return [
        build([5], [3]),
        build([3], [5]),
        circuit(200000, true),
        circuit(200000, false),
        build(
          range(1000, () => 7),
          range(1000, () => 7),
        ),
        circuit(1000, true),
      ];
    },
    solve: (s) => {
      const [n, ...rest] = nums(s);
      let tank = 0;
      let total = 0;
      let start = 0;
      for (let i = 0; i < n!; i++) {
        const gain = rest[i]! - rest[n! + i]!;
        total += gain;
        tank += gain;
        if (tank < 0) {
          start = i + 1;
          tank = 0;
        }
      }
      return String(total >= 0 ? start : -1);
    },
    python: py(`
      import sys
      d = sys.stdin.read().split()
      n = int(d[0])
      g = list(map(int, d[1:1 + n]))
      c = list(map(int, d[1 + n:1 + 2 * n]))
      P = [0] * (n + 1)  # P[k] = fuel balance after the first k legs from station 0
      for i in range(n):
          P[i + 1] = P[i] + g[i] - c[i]
      total = P[n]
      INF = float('inf')
      suf = [INF] * (n + 2)  # suf[i] = min(P[i..n])
      for i in range(n, 0, -1):
          suf[i] = min(suf[i + 1], P[i])
      pre = [INF] * (n + 1)  # pre[i] = min(P[1..i])
      for i in range(1, n + 1):
          pre[i] = min(pre[i - 1], P[i])
      ans = -1
      for i in range(n):
          # start at i: partial sums are P[k] - P[i] (k > i) and total + P[k] - P[i] (k <= i); all must be >= 0
          if suf[i + 1] >= P[i] and (i == 0 or pre[i] + total >= P[i]):
              ans = i
              break
      print(ans)
    `),
  },
  {
    slug: 'max-product-subarray',
    title: 'Best Product Streak',
    difficulty: 'MEDIUM',
    statement: statement(
      `Given \`n\` integers (which may be negative or zero), find the largest possible **product** of a non-empty block of consecutive elements.

For \`2 3 -2 4\` the best block is \`2 3\` with product 6 (including \`-2\` would make the product negative). For \`-2 0 -1\` the answer is 0: every block containing 0 has product 0, and the single elements are -2 and -1.

The product can be much larger than a 64-bit integer, so print the exact value.`,
      'The first line contains `n`. The second line contains `n` integers `a1 … an`.',
      'Print the maximum product of a non-empty block of consecutive elements, exactly.',
      ['1 ≤ n ≤ 60', '|ai| ≤ 10'],
    ),
    samples: ['4\n2 3 -2 4\n', '3\n-2 0 -1\n'],
    hidden: (r) => [
      arrInput([-5]),
      arrInput(range(60, () => -10)),
      arrInput(range(59, () => -10)),
      arrInput([3, -1, 0, 2, 2, -5, 1, 0, -4]),
      arrInput(r.ints(60, -10, 10)),
      arrInput(r.ints(60, -3, 3)),
    ],
    solve: (s) => {
      const [n, ...rest] = nums(s);
      const a = rest.slice(0, n).map((x) => BigInt(x));
      let hi = a[0]!;
      let lo = a[0]!;
      let best = a[0]!;
      for (const x of a.slice(1)) {
        const cands = [x, hi * x, lo * x];
        hi = cands.reduce((p, q) => (q > p ? q : p));
        lo = cands.reduce((p, q) => (q < p ? q : p));
        if (hi > best) best = hi;
      }
      return best.toString();
    },
    python: py(`
      import sys
      d = sys.stdin.read().split()
      n = int(d[0])
      a = list(map(int, d[1:1 + n]))
      best = a[0]
      for i in range(n):
          p = 1
          for j in range(i, n):
              p *= a[j]
              if p > best:
                  best = p
      print(best)
    `),
  },
  {
    slug: 'longest-subarray-diff',
    title: 'Calm Stretch of Readings',
    difficulty: 'MEDIUM',
    statement: statement(
      `A sensor produced \`n\` readings. A block of consecutive readings is **calm** if the difference between its largest and smallest reading is **at most** \`k\`. Find the length of the longest calm block.

For readings \`1 3 2 6 5 4\` and \`k = 2\`, the block \`1 3 2\` is calm (max 3, min 1, difference 2) and so is \`6 5 4\`, but no calm block has 4 readings: any 4-block spans a difference of at least 4. The answer is 3. For a single reading the block of length 1 is always calm.`,
      'The first line contains `n k`. The second line contains `n` integers `a1 … an`.',
      'Print the length of the longest calm block.',
      ['1 ≤ n ≤ 2·10^5', '0 ≤ ai ≤ 10^9', '0 ≤ k ≤ 10^9'],
    ),
    samples: ['6 2\n1 3 2 6 5 4\n', '1 0\n5\n'],
    hidden: (r) => {
      let walk = 1000;
      const steps = range(200000, () => (walk = Math.max(0, walk + r.int(-3, 3))));
      return [
        arrInput(
          range(1000, (i) => Math.floor(i / 37) % 4),
          [1000, 0],
        ),
        arrInput(r.ints(200000, 0, 1e9), [200000, 1e9]),
        arrInput(steps, [200000, 10]),
        arrInput(r.ints(200000, 0, 1e9), [200000, 1e8]),
        arrInput(
          range(200000, (i) => i),
          [200000, 5],
        ),
        arrInput(r.ints(200000, 0, 5), [200000, 2]),
      ];
    },
    solve: (s) => {
      const [n, k, ...rest] = nums(s);
      const a = rest.slice(0, n);
      const maxQ = new Int32Array(n!);
      const minQ = new Int32Array(n!);
      let mh = 0;
      let mt = 0;
      let nh = 0;
      let nt = 0;
      let l = 0;
      let best = 0;
      for (let i = 0; i < n!; i++) {
        while (mt > mh && a[maxQ[mt - 1]!]! <= a[i]!) mt--;
        maxQ[mt++] = i;
        while (nt > nh && a[minQ[nt - 1]!]! >= a[i]!) nt--;
        minQ[nt++] = i;
        while (a[maxQ[mh]!]! - a[minQ[nh]!]! > k!) {
          l++;
          if (maxQ[mh]! < l) mh++;
          if (minQ[nh]! < l) nh++;
        }
        best = Math.max(best, i - l + 1);
      }
      return String(best);
    },
    python: py(`
      import sys, heapq
      d = sys.stdin.buffer.read().split()
      n, k = int(d[0]), int(d[1])
      a = list(map(int, d[2:2 + n]))
      hi, lo = [], []
      l = 0
      best = 0
      for i, x in enumerate(a):
          heapq.heappush(hi, (-x, i))
          heapq.heappush(lo, (x, i))
          while True:
              while hi[0][1] < l: heapq.heappop(hi)
              while lo[0][1] < l: heapq.heappop(lo)
              if -hi[0][0] - lo[0][0] <= k: break
              l += 1
          best = max(best, i - l + 1)
      print(best)
    `),
  },
  {
    slug: 'pattern-occurrences',
    title: 'Pattern in the Text',
    difficulty: 'MEDIUM',
    timeLimitMs: 2000,
    statement: statement(
      `Given a text \`t\` and a pattern \`p\`, count how many positions of \`t\` start an occurrence of \`p\`. **Overlapping** occurrences all count.

For \`t = aaaaa\` and \`p = aa\` the pattern starts at positions 1, 2, 3 and 4, so the answer is 4. For \`t = abcabcab\` and \`p = abc\` it starts at positions 1 and 4, so the answer is 2.

A naive check at every position can take far too long on inputs like \`aaaa…a\`; you need a linear-time method (prefix function, Z-function or hashing).`,
      'The first line contains the text `t`, the second line contains the pattern `p`. Both consist of lowercase letters.',
      'Print the number of positions where `p` occurs in `t`.',
      ['1 ≤ |p| ≤ |t| ≤ 2·10^5'],
    ),
    samples: ['aaaaa\naa\n', 'abcabcab\nabc\n'],
    hidden: (r) => [
      `${'a'.repeat(200000)}\n${'a'.repeat(100000)}\n`,
      `${'a'.repeat(200000)}\na\n`,
      `${r.word(200000, 'ab')}\nabab\n`,
      `${'ab'.repeat(100000)}\n${'ab'.repeat(500)}\n`,
      `${'a'.repeat(199999)}b\n${'a'.repeat(50000)}b\n`,
      `${r.word(200000)}\n${r.word(3)}\n`,
    ],
    solve: (s) => {
      const [t, p] = lines(s);
      const m = p!.length;
      const fail = new Int32Array(m);
      for (let i = 1, k = 0; i < m; i++) {
        while (k > 0 && p![i] !== p![k]) k = fail[k - 1]!;
        if (p![i] === p![k]) k++;
        fail[i] = k;
      }
      let count = 0;
      for (let i = 0, k = 0; i < t!.length; i++) {
        while (k > 0 && t![i] !== p![k]) k = fail[k - 1]!;
        if (t![i] === p![k]) k++;
        if (k === m) {
          count++;
          k = fail[k - 1]!;
        }
      }
      return String(count);
    },
    python: py(`
      import sys
      t = sys.stdin.readline().strip()
      p = sys.stdin.readline().strip()
      n, m = len(t), len(p)
      M = (1 << 61) - 1
      B = 1000003
      hp = 0
      for ch in p:
          hp = (hp * B + ord(ch)) % M
      h = 0
      for ch in t[:m]:
          h = (h * B + ord(ch)) % M
      top = pow(B, m - 1, M)
      count = 1 if h == hp else 0
      for i in range(m, n):
          h = ((h - ord(t[i - m]) * top) * B + ord(t[i])) % M
          if h == hp:
              count += 1
      print(count)
    `),
  },
];

/** Like `relabel`, but vertex 1 stays the root (for problems rooted at vertex 1). */
function relabelKeepRoot(
  r: Parameters<typeof relabel>[0],
  n: number,
  edges: number[][],
): number[][] {
  const perm = [1, ...r.shuffle(range(n - 1, (i) => i + 2))];
  return edges.map(([a, b]) => [perm[a! - 1]!, perm[b! - 1]!]);
}
