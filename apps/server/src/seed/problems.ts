import type { Difficulty } from '@thegrave/shared';
import { MinHeap, type Rng } from './rng.js';

export interface ProblemDef {
  slug: string;
  title: string;
  difficulty: Difficulty;
  statement: string;
  timeLimitMs?: number;
  samples: string[];
  /** Hidden test inputs; expected outputs are computed by `solve`. */
  hidden: (r: Rng) => string[];
  /** Reference solution used to generate expected outputs. */
  solve: (input: string) => string;
  /** Independent Python solution; the test suite checks it is ACCEPTED, cross-validating `solve`. */
  python: string;
}

// ---- helpers -------------------------------------------------------------------------------

const nums = (s: string) => s.split(/\s+/).filter(Boolean).map(Number);
const lines = (s: string) => s.split('\n').map((l) => l.trim());
const arrInput = (a: number[], head: (number | string)[] = [a.length]) =>
  `${head.join(' ')}\n${a.join(' ')}\n`;
const range = <T = number>(n: number, f: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => f(i));

/** Strip the common indentation so Python sources can be written inline. */
function py(src: string): string {
  const ls = src.replace(/^\n/, '').replace(/\s+$/, '').split('\n');
  const indent = Math.min(...ls.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  return ls.map((l) => l.slice(indent)).join('\n') + '\n';
}

const statement = (body: string, input: string, output: string, constraints: string[]) =>
  `${body}\n\n### Input\n${input}\n\n### Output\n${output}\n\n### Constraints\n${constraints.map((c) => `- ${c}`).join('\n')}\n`;

const balancedBrackets = (r: Rng, pairs: number) => {
  const open = '([{';
  const close: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const stack: string[] = [];
  let out = '';
  let opened = 0;
  while (out.length < pairs * 2) {
    if (opened < pairs && (stack.length === 0 || r.float() < 0.5)) {
      const c = r.pick([...open]);
      stack.push(c);
      out += c;
      opened++;
    } else {
      out += close[stack.pop()!];
    }
  }
  return out;
};

const randomGrid = (r: Rng, n: number, m: number, landProb: number) =>
  range(n, () => 0)
    .map(() =>
      range(m, () => (r.float() < landProb ? 1 : 0))
        .map((b) => (b ? '#' : '.'))
        .join(''),
    )
    .join('\n');

const randomDag = (r: Rng, n: number, m: number) => {
  const order = r.shuffle(range(n, (i) => i + 1));
  const edges: [number, number][] = [];
  for (let i = 0; i < m; i++) {
    let a = r.int(0, n - 1);
    let b = r.int(0, n - 1);
    if (a === b) b = (b + 1) % n;
    if (a > b) [a, b] = [b, a];
    edges.push([order[a]!, order[b]!]);
  }
  return edges;
};

const edgeInput = (n: number, edges: number[][]) =>
  `${n} ${edges.length}\n${edges.map((e) => e.join(' ')).join('\n')}${edges.length ? '\n' : ''}`;

// ---- problems ------------------------------------------------------------------------------

export const problems: ProblemDef[] = [
  // ===================================== EASY ==============================================
  {
    slug: 'sum-of-array',
    title: 'Sum of Array',
    difficulty: 'EASY',
    statement: statement(
      'Given an array of integers, print the sum of its elements.',
      'The first line contains `n`. The second line contains `n` integers `a1 … an`.',
      'Print the sum.',
      ['1 ≤ n ≤ 2·10^5', '|ai| ≤ 10^9 (the sum may not fit in 32 bits)'],
    ),
    samples: ['5\n1 2 3 4 5\n', '3\n-1 0 1\n'],
    hidden: (r) => [
      '1\n1000000000\n',
      '1\n-1000000000\n',
      arrInput(range(200000, () => 1e9)),
      arrInput(range(200000, () => -1e9)),
      arrInput(r.ints(10, -100, 100)),
      arrInput(r.ints(1000, -1e9, 1e9)),
      arrInput(r.ints(200000, -1e9, 1e9)),
    ],
    solve: (s) => {
      const [n, ...a] = nums(s);
      return String(a.slice(0, n).reduce((x, y) => x + y, 0));
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      n = int(d[0])
      print(sum(map(int, d[1:1 + n])))
    `),
  },
  {
    slug: 'reverse-words',
    title: 'Reverse Words',
    difficulty: 'EASY',
    statement: statement(
      'Reverse the order of the words in a sentence.',
      'A single line of words made of lowercase letters, separated by single spaces.',
      'The words in reverse order, separated by single spaces.',
      ['1 ≤ number of words ≤ 10^5', '1 ≤ word length ≤ 10'],
    ),
    samples: ['the quick brown fox\n', 'hello\n'],
    hidden: (r) => [
      'a\n',
      'ab ba\n',
      `${range(20, () => 0)
        .map(() => r.word(r.int(1, 10)))
        .join(' ')}\n`,
      `${range(100000, () => 0)
        .map(() => r.word(r.int(1, 10)))
        .join(' ')}\n`,
      `${range(100000, () => 0)
        .map(() => 'x')
        .join(' ')}\n`,
    ],
    solve: (s) => lines(s)[0]!.split(' ').reverse().join(' '),
    python: py(`
      import sys
      print(' '.join(sys.stdin.readline().split()[::-1]))
    `),
  },
  {
    slug: 'fizzbuzz',
    title: 'FizzBuzz',
    difficulty: 'EASY',
    statement: statement(
      'For each integer `i` from 1 to `n`, print `FizzBuzz` if `i` is divisible by 15, `Fizz` if divisible by 3, `Buzz` if divisible by 5, and `i` otherwise.',
      'A single integer `n`.',
      '`n` lines.',
      ['1 ≤ n ≤ 10^5'],
    ),
    samples: ['5\n', '15\n'],
    hidden: (r) => ['1\n', '3\n', '100\n', `${r.int(1000, 5000)}\n`, '99999\n', '100000\n'],
    solve: (s) =>
      range(nums(s)[0]!, (i) => i + 1)
        .map((i) =>
          i % 15 === 0 ? 'FizzBuzz' : i % 3 === 0 ? 'Fizz' : i % 5 === 0 ? 'Buzz' : String(i),
        )
        .join('\n'),
    python: py(`
      n = int(input())
      out = []
      for i in range(1, n + 1):
          if i % 15 == 0: out.append('FizzBuzz')
          elif i % 3 == 0: out.append('Fizz')
          elif i % 5 == 0: out.append('Buzz')
          else: out.append(str(i))
      print('\\n'.join(out))
    `),
  },
  {
    slug: 'count-vowels',
    title: 'Count Vowels',
    difficulty: 'EASY',
    statement: statement(
      'Count the vowels (`a`, `e`, `i`, `o`, `u`) in a string.',
      'A single line containing a string of lowercase letters.',
      'The number of vowels.',
      ['1 ≤ length ≤ 10^5'],
    ),
    samples: ['hello\n', 'rhythm\n'],
    hidden: (r) => [
      'a\n',
      'b\n',
      `${r.word(100000, 'aeiou')}\n`,
      `${r.word(100000, 'bcdfg')}\n`,
      `${r.word(50, 'abcdefghijklmnopqrstuvwxyz')}\n`,
      `${r.word(100000)}\n`,
    ],
    solve: (s) => String([...lines(s)[0]!].filter((c) => 'aeiou'.includes(c)).length),
    python: py(`
      s = input().strip()
      print(sum(s.count(c) for c in 'aeiou'))
    `),
  },
  {
    slug: 'palindrome-check',
    title: 'Palindrome Check',
    difficulty: 'EASY',
    statement: statement(
      'Decide whether a string reads the same forwards and backwards.',
      'A single line containing a string of lowercase letters.',
      '`YES` if it is a palindrome, otherwise `NO`.',
      ['1 ≤ length ≤ 10^5'],
    ),
    samples: ['racecar\n', 'abca\n'],
    hidden: (r) => {
      const half = r.word(50000, 'ab');
      const rev = [...half].reverse().join('');
      const near = [...(half + rev)];
      near[30000] = near[30000] === 'a' ? 'b' : 'a';
      return [
        'a\n',
        'ab\n',
        'aa\n',
        `${half}${rev}\n`,
        `${half}z${rev}\n`,
        `${near.join('')}\n`,
        `${r.word(1000)}\n`,
      ];
    },
    solve: (s) => {
      const w = lines(s)[0]!;
      return w === [...w].reverse().join('') ? 'YES' : 'NO';
    },
    python: py(`
      s = input().strip()
      print('YES' if s == s[::-1] else 'NO')
    `),
  },
  {
    slug: 'second-largest',
    title: 'Second Largest Distinct',
    difficulty: 'EASY',
    statement: statement(
      'Print the second largest **distinct** value in the array.',
      'The first line contains `n`. The second line contains `n` integers.',
      'The second largest distinct value, or `NONE` if all values are equal.',
      ['1 ≤ n ≤ 2·10^5', '|ai| ≤ 10^9'],
    ),
    samples: ['5\n3 1 4 1 5\n', '3\n7 7 7\n'],
    hidden: (r) => [
      '1\n5\n',
      '2\n-1 -1\n',
      '2\n0 -1\n',
      '2\n-1000000000 1000000000\n',
      arrInput([...range(100000, () => 1e9), ...r.ints(100000, -1e9, 1e9 - 1)]),
      arrInput(r.ints(200000, -5, 5)),
      arrInput(r.ints(200000, -1e9, 1e9)),
    ],
    solve: (s) => {
      const [n, ...a] = nums(s);
      const vals = [...new Set(a.slice(0, n))].sort((x, y) => y - x);
      return vals.length < 2 ? 'NONE' : String(vals[1]);
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      s = set(map(int, d[1:1 + int(d[0])]))
      if len(s) < 2:
          print('NONE')
      else:
          s.remove(max(s))
          print(max(s))
    `),
  },
  {
    slug: 'max-consecutive-ones',
    title: 'Max Consecutive Ones',
    difficulty: 'EASY',
    statement: statement(
      'Find the length of the longest run of consecutive `1`s in a binary array.',
      'The first line contains `n`. The second line contains `n` values, each `0` or `1`.',
      'The length of the longest run of `1`s (0 if there are none).',
      ['1 ≤ n ≤ 2·10^5'],
    ),
    samples: ['6\n1 1 0 1 1 1\n', '3\n0 0 0\n'],
    hidden: (r) => [
      '1\n1\n',
      '1\n0\n',
      arrInput(range(200000, () => 1)),
      arrInput(range(200000, (i) => i % 2)),
      arrInput(range(200000, () => (r.float() < 0.9 ? 1 : 0))),
      arrInput(r.ints(1000, 0, 1)),
    ],
    solve: (s) => {
      const [n, ...a] = nums(s);
      let best = 0;
      let cur = 0;
      for (const x of a.slice(0, n)) {
        cur = x === 1 ? cur + 1 : 0;
        best = Math.max(best, cur);
      }
      return String(best);
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      best = cur = 0
      for x in d[1:1 + int(d[0])]:
          if x == b'1':
              cur += 1
              if cur > best: best = cur
          else:
              cur = 0
      print(best)
    `),
  },
  {
    slug: 'missing-number',
    title: 'Missing Number',
    difficulty: 'EASY',
    statement: statement(
      'The numbers `1 … n` were shuffled and exactly one was removed. Find it.',
      'The first line contains `n`. The second line contains `n − 1` distinct integers from `1 … n`.',
      'The missing number.',
      ['2 ≤ n ≤ 2·10^5'],
    ),
    samples: ['5\n3 1 5 2\n', '2\n2\n'],
    hidden: (r) => {
      const missing = (n: number, m: number) =>
        arrInput(r.shuffle(range(n, (i) => i + 1).filter((x) => x !== m)), [n]);
      return [
        missing(2, 2),
        missing(10, 1),
        missing(200000, 200000),
        missing(200000, 1),
        missing(200000, r.int(1, 200000)),
        missing(1000, r.int(1, 1000)),
      ];
    },
    solve: (s) => {
      const [n, ...a] = nums(s);
      return String((n! * (n! + 1)) / 2 - a.reduce((x, y) => x + y, 0));
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      n = int(d[0])
      seen = bytearray(n + 1)
      for x in d[1:n]:
          seen[int(x)] = 1
      print(next(i for i in range(1, n + 1) if not seen[i]))
    `),
  },
  {
    slug: 'anagram-check',
    title: 'Anagram Check',
    difficulty: 'EASY',
    statement: statement(
      'Decide whether two strings are anagrams (one is a rearrangement of the other).',
      'Two lines, each containing a string of lowercase letters.',
      '`YES` or `NO`.',
      ['1 ≤ length of each string ≤ 10^5'],
    ),
    samples: ['listen\nsilent\n', 'rat\ncar\n'],
    hidden: (r) => {
      const big = r.word(100000);
      const shuffled = r.shuffle([...big]);
      const changed = [...shuffled];
      changed[500] = changed[500] === 'a' ? 'b' : 'a';
      return [
        'a\na\n',
        'a\nb\n',
        'ab\nabc\n',
        `${big}\n${shuffled.join('')}\n`,
        `${big}\n${changed.join('')}\n`,
        `${r.word(100000, 'ab')}\n${r.word(100000, 'ab')}\n`,
      ];
    },
    solve: (s) => {
      const [a, b] = lines(s);
      const sort = (x: string) => [...x].sort().join('');
      return sort(a!) === sort(b!) ? 'YES' : 'NO';
    },
    python: py(`
      from collections import Counter
      a = input().strip()
      b = input().strip()
      print('YES' if Counter(a) == Counter(b) else 'NO')
    `),
  },
  {
    slug: 'range-sum-queries',
    title: 'Range Sum Queries',
    difficulty: 'EASY',
    statement: statement(
      'Answer `q` queries, each asking for the sum of `a[l] … a[r]` (1-indexed, inclusive).',
      'The first line contains `n q`. The second line contains `n` integers. Each of the next `q` lines contains `l r`.',
      'For each query, print the sum on its own line.',
      ['1 ≤ n, q ≤ 10^5', '|ai| ≤ 10^9', '1 ≤ l ≤ r ≤ n'],
    ),
    samples: ['5 3\n1 2 3 4 5\n1 5\n2 3\n4 4\n'],
    hidden: (r) => {
      const gen = (n: number, q: number, lo: number, hi: number, full = false) => {
        const qs = range(q, () => 0).map(() => {
          if (full) return '1 ' + n;
          const a = r.int(1, n);
          const b = r.int(1, n);
          return `${Math.min(a, b)} ${Math.max(a, b)}`;
        });
        return `${n} ${q}\n${r.ints(n, lo, hi).join(' ')}\n${qs.join('\n')}\n`;
      };
      return [
        '1 1\n-7\n1 1\n',
        gen(100000, 100000, 1e9, 1e9, true),
        gen(100000, 100000, -1e9, 1e9),
        gen(100, 100, -10, 10),
      ];
    },
    solve: (s) => {
      const t = nums(s);
      const [n, q] = t as [number, number];
      const pre = [0];
      for (let i = 0; i < n; i++) pre.push(pre[i]! + t[2 + i]!);
      const out: number[] = [];
      for (let i = 0; i < q; i++) {
        const l = t[2 + n + 2 * i]!;
        const rr = t[3 + n + 2 * i]!;
        out.push(pre[rr]! - pre[l - 1]!);
      }
      return out.join('\n');
    },
    python: py(`
      import sys
      from itertools import accumulate
      d = sys.stdin.buffer.read().split()
      n, q = int(d[0]), int(d[1])
      pre = [0] + list(accumulate(map(int, d[2:2 + n])))
      out = []
      idx = 2 + n
      for _ in range(q):
          l, r = int(d[idx]), int(d[idx + 1])
          idx += 2
          out.append(pre[r] - pre[l - 1])
      print('\\n'.join(map(str, out)))
    `),
  },

  // ==================================== MEDIUM =============================================
  {
    slug: 'max-subarray-sum',
    title: 'Maximum Subarray Sum',
    difficulty: 'MEDIUM',
    statement: statement(
      'Find the largest sum of a non-empty contiguous subarray.',
      'The first line contains `n`. The second line contains `n` integers.',
      'The maximum subarray sum.',
      ['1 ≤ n ≤ 2·10^5', '|ai| ≤ 10^9'],
    ),
    samples: ['9\n-2 1 -3 4 -1 2 1 -5 4\n', '3\n-3 -1 -2\n'],
    hidden: (r) => [
      '1\n-5\n',
      arrInput(r.ints(200000, -1e9, -1)),
      arrInput(range(200000, () => 1e9)),
      arrInput(r.ints(200000, -1e9, 1e9)),
      arrInput(r.ints(1000, -100, 100)),
    ],
    solve: (s) => {
      const [n, ...a] = nums(s);
      let best = -Infinity;
      let cur = 0;
      for (const x of a.slice(0, n)) {
        cur = Math.max(x, cur + x);
        best = Math.max(best, cur);
      }
      return String(best);
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      a = list(map(int, d[1:1 + int(d[0])]))
      best = a[0]
      cur = 0
      for x in a:
          cur = cur + x if cur > 0 else x
          if cur > best: best = cur
      print(best)
    `),
  },
  {
    slug: 'pair-sum-count',
    title: 'Pair Sum Count',
    difficulty: 'MEDIUM',
    statement: statement(
      'Count the pairs of indices `i < j` with `a[i] + a[j] = t`.',
      'The first line contains `n t`. The second line contains `n` integers.',
      'The number of pairs (may not fit in 32 bits).',
      ['1 ≤ n ≤ 2·10^5', '|ai| ≤ 10^9', '|t| ≤ 2·10^9'],
    ),
    samples: ['5 6\n1 5 3 3 7\n', '4 2\n1 1 1 1\n'],
    hidden: (r) => [
      '1 2\n1\n',
      arrInput(
        range(200000, () => 7),
        [200000, 14],
      ),
      arrInput(r.ints(200000, -10, 10), [200000, 0]),
      arrInput(r.ints(200000, -1e9, 1e9), [200000, r.int(-1e9, 1e9)]),
      arrInput(r.ints(200000, 1, 1000), [200000, 1000]),
    ],
    solve: (s) => {
      const [n, t, ...a] = nums(s);
      const seen = new Map<number, number>();
      let count = 0;
      for (const x of a.slice(0, n)) {
        count += seen.get(t! - x) ?? 0;
        seen.set(x, (seen.get(x) ?? 0) + 1);
      }
      return String(count);
    },
    python: py(`
      import sys
      from collections import Counter
      d = sys.stdin.buffer.read().split()
      n, t = int(d[0]), int(d[1])
      c = Counter(map(int, d[2:2 + n]))
      total = 0
      for x, k in c.items():
          y = t - x
          if x < y:
              total += k * c.get(y, 0)
          elif x == y:
              total += k * (k - 1) // 2
      print(total)
    `),
  },
  {
    slug: 'longest-unique-substring',
    title: 'Longest Substring Without Repeats',
    difficulty: 'MEDIUM',
    statement: statement(
      'Find the length of the longest substring in which no character repeats.',
      'A single line containing a string of lowercase letters.',
      'The length of the longest such substring.',
      ['1 ≤ length ≤ 10^5'],
    ),
    samples: ['abcabcbb\n', 'bbbbb\n'],
    hidden: (r) => [
      'a\n',
      `${'abcdefghijklmnopqrstuvwxyz'.repeat(3000)}\n`,
      `${r.word(100000, 'abcde')}\n`,
      `${r.word(100000)}\n`,
      `${r.word(30)}\n`,
    ],
    solve: (s) => {
      const w = lines(s)[0]!;
      const last = new Map<string, number>();
      let start = 0;
      let best = 0;
      for (let i = 0; i < w.length; i++) {
        const p = last.get(w[i]!);
        if (p !== undefined && p >= start) start = p + 1;
        last.set(w[i]!, i);
        best = Math.max(best, i - start + 1);
      }
      return String(best);
    },
    python: py(`
      s = input().strip()
      count = [0] * 26
      lo = best = 0
      for hi, ch in enumerate(s):
          c = ord(ch) - 97
          count[c] += 1
          while count[c] > 1:
              count[ord(s[lo]) - 97] -= 1
              lo += 1
          best = max(best, hi - lo + 1)
      print(best)
    `),
  },
  {
    slug: 'balanced-brackets',
    title: 'Balanced Brackets',
    difficulty: 'MEDIUM',
    statement: statement(
      'Decide whether a string of brackets `()[]{}` is balanced: every opening bracket is closed by the matching type in the correct order.',
      'A single line containing the bracket string.',
      '`YES` or `NO`.',
      ['1 ≤ length ≤ 10^5'],
    ),
    samples: ['([]{})\n', '([)]\n'],
    hidden: (r) => {
      const big = balancedBrackets(r, 50000);
      const broken = [...big];
      const i = broken.indexOf(')');
      broken[i] = ']';
      return [
        '(\n',
        ')\n',
        `${'('.repeat(50000)}${')'.repeat(50000)}\n`,
        `${big}\n`,
        `${broken.join('')}\n`,
        `${balancedBrackets(r, 100)}(\n`,
        `${r.word(1000, '()[]{}')}\n`,
      ];
    },
    solve: (s) => {
      const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
      const stack: string[] = [];
      for (const c of lines(s)[0]!) {
        if (pairs[c]) {
          if (stack.pop() !== pairs[c]) return 'NO';
        } else stack.push(c);
      }
      return stack.length ? 'NO' : 'YES';
    },
    python: py(`
      s = input().strip()
      match = {')': '(', ']': '[', '}': '{'}
      st = []
      ok = True
      for c in s:
          if c in match:
              if not st or st.pop() != match[c]:
                  ok = False
                  break
          else:
              st.append(c)
      print('YES' if ok and not st else 'NO')
    `),
  },
  {
    slug: 'merge-intervals',
    title: 'Merge Intervals',
    difficulty: 'MEDIUM',
    statement: statement(
      'Merge all overlapping closed intervals. Intervals that share an endpoint (e.g. `[1,3]` and `[3,5]`) overlap; `[1,2]` and `[3,4]` do not.',
      'The first line contains `n`. Each of the next `n` lines contains `l r`.',
      'First print `k`, the number of merged intervals, then `k` lines `l r` sorted by `l`.',
      ['1 ≤ n ≤ 10^5', '0 ≤ l ≤ r ≤ 10^9'],
    ),
    samples: ['4\n1 3\n2 6\n8 10\n15 18\n', '2\n1 4\n4 5\n'],
    hidden: (r) => {
      const gen = (n: number, maxL: number, maxLen: number) =>
        `${n}\n${range(n, () => 0)
          .map(() => {
            const l = r.int(0, maxL);
            return `${l} ${Math.min(1e9, l + r.int(0, maxLen))}`;
          })
          .join('\n')}\n`;
      return [
        '1\n5 5\n',
        '2\n1 2\n3 4\n',
        '3\n1 10\n2 3\n4 5\n',
        gen(100000, 1e9, 10000),
        gen(100000, 1e9, 1e7),
        gen(1000, 100, 3),
      ];
    },
    solve: (s) => {
      const t = nums(s);
      const iv = range(t[0]!, (i) => [t[1 + 2 * i]!, t[2 + 2 * i]!] as [number, number]).sort(
        (a, b) => a[0] - b[0],
      );
      const out: [number, number][] = [];
      for (const [l, rr] of iv) {
        const last = out[out.length - 1];
        if (last && l <= last[1]) last[1] = Math.max(last[1], rr);
        else out.push([l, rr]);
      }
      return [out.length, ...out.map((x) => x.join(' '))].join('\n');
    },
    python: py(`
      import sys
      d = list(map(int, sys.stdin.buffer.read().split()))
      n = d[0]
      iv = sorted(zip(d[1:2 * n + 1:2], d[2:2 * n + 2:2]))
      out = []
      cl, cr = iv[0]
      for l, r in iv[1:]:
          if l <= cr:
              cr = max(cr, r)
          else:
              out.append((cl, cr))
              cl, cr = l, r
      out.append((cl, cr))
      print(len(out))
      print('\\n'.join(f'{l} {r}' for l, r in out))
    `),
  },
  {
    slug: 'kth-smallest',
    title: 'K-th Smallest',
    difficulty: 'MEDIUM',
    statement: statement(
      'Print the `k`-th smallest element of the array (duplicates count separately).',
      'The first line contains `n k`. The second line contains `n` integers.',
      'The `k`-th smallest element.',
      ['1 ≤ k ≤ n ≤ 2·10^5', '|ai| ≤ 10^9'],
    ),
    samples: ['5 2\n3 1 4 1 5\n', '1 1\n42\n'],
    hidden: (r) => [
      arrInput(r.ints(200000, -1e9, 1e9), [200000, 1]),
      arrInput(r.ints(200000, -1e9, 1e9), [200000, 200000]),
      arrInput(r.ints(200000, 0, 3), [200000, 100000]),
      arrInput(r.ints(200000, -1e9, 1e9), [200000, r.int(1, 200000)]),
      arrInput(r.ints(10, -5, 5), [10, 4]),
    ],
    solve: (s) => {
      const [n, k, ...a] = nums(s);
      return String(a.slice(0, n).sort((x, y) => x - y)[k! - 1]);
    },
    python: py(`
      import sys, heapq
      d = sys.stdin.buffer.read().split()
      n, k = int(d[0]), int(d[1])
      print(heapq.nsmallest(k, map(int, d[2:2 + n]))[-1])
    `),
  },
  {
    slug: 'grid-paths',
    title: 'Grid Paths',
    difficulty: 'MEDIUM',
    statement: statement(
      'Count the paths from the top-left to the bottom-right cell of a grid, moving only right or down and never entering a blocked cell (`#`). Print the count modulo 10^9 + 7.',
      'The first line contains `n m`. Each of the next `n` lines contains `m` characters, `.` (free) or `#` (blocked).',
      'The number of paths modulo 10^9 + 7 (0 if the start or end is blocked).',
      ['1 ≤ n, m ≤ 500'],
    ),
    samples: ['3 3\n...\n.#.\n...\n', '2 2\n.#\n#.\n'],
    hidden: (r) => [
      '1 1\n.\n',
      '1 1\n#\n',
      `500 500\n${randomGrid(r, 500, 500, 0)}\n`,
      `500 500\n${randomGrid(r, 500, 500, 0.1)}\n`,
      `300 400\n${randomGrid(r, 300, 400, 0.05)}\n`,
      `10 10\n${randomGrid(r, 10, 10, 0.3)}\n`,
      `1 500\n${randomGrid(r, 1, 500, 0)}\n`,
    ],
    solve: (s) => {
      const [head, ...rows] = lines(s);
      const [n, m] = nums(head!) as [number, number];
      const MOD = 1_000_000_007;
      const dp = new Array<number>(m).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < m; j++) {
          if (rows[i]![j] === '#') dp[j] = 0;
          else if (i === 0 && j === 0) dp[j] = 1;
          else dp[j] = (dp[j]! + (j > 0 ? dp[j - 1]! : 0)) % MOD;
        }
      }
      return String(dp[m - 1]);
    },
    python: py(`
      import sys
      data = sys.stdin.read().split()
      n, m = int(data[0]), int(data[1])
      g = data[2:2 + n]
      MOD = 10**9 + 7
      prev = [0] * (m + 1)
      for i in range(n):
          cur = [0] * (m + 1)
          row = g[i]
          for j in range(m):
              if row[j] == '.':
                  v = prev[j + 1] + cur[j]
                  if i == 0 and j == 0: v = 1
                  cur[j + 1] = v % MOD
          prev = cur
      print(prev[m])
    `),
  },
  {
    slug: 'coin-change',
    title: 'Coin Change',
    difficulty: 'MEDIUM',
    statement: statement(
      'Using an unlimited supply of each coin denomination, find the minimum number of coins that sum to `amount`.',
      'The first line contains `n amount`. The second line contains `n` coin values.',
      'The minimum number of coins, or `-1` if `amount` cannot be made.',
      ['1 ≤ n ≤ 100', '0 ≤ amount ≤ 10^4', '1 ≤ coin ≤ 10^4'],
    ),
    samples: ['3 11\n1 2 5\n', '1 3\n2\n'],
    hidden: (r) => [
      '1 0\n7\n',
      '2 10000\n9999 10000\n',
      '3 9999\n2 4 6\n',
      arrInput(r.ints(100, 1, 10000), [100, 10000]),
      arrInput(r.ints(100, 50, 500), [100, 9973]),
      arrInput([186, 419, 83, 408], [4, 6249]),
      arrInput(r.ints(5, 1, 20), [5, r.int(1, 100)]),
    ],
    solve: (s) => {
      const [n, amount, ...coins] = nums(s);
      const INF = Number.MAX_SAFE_INTEGER;
      const dp = new Array<number>(amount! + 1).fill(INF);
      dp[0] = 0;
      for (let a = 1; a <= amount!; a++) {
        for (const c of coins.slice(0, n))
          if (c <= a && dp[a - c]! + 1 < dp[a]!) dp[a] = dp[a - c]! + 1;
      }
      return String(dp[amount!] === INF ? -1 : dp[amount!]);
    },
    python: py(`
      import sys
      d = list(map(int, sys.stdin.buffer.read().split()))
      n, amount = d[0], d[1]
      coins = sorted(set(d[2:2 + n]))
      INF = float('inf')
      dp = [0] + [INF] * amount
      for c in coins:
          for a in range(c, amount + 1):
              v = dp[a - c] + 1
              if v < dp[a]:
                  dp[a] = v
      print(dp[amount] if dp[amount] != INF else -1)
    `),
  },
  {
    slug: 'lis-length',
    title: 'Longest Increasing Subsequence',
    difficulty: 'MEDIUM',
    statement: statement(
      'Find the length of the longest **strictly** increasing subsequence.',
      'The first line contains `n`. The second line contains `n` integers.',
      'The length of the LIS.',
      ['1 ≤ n ≤ 2·10^5', '|ai| ≤ 10^9'],
    ),
    samples: ['8\n10 9 2 5 3 7 101 18\n', '3\n5 5 5\n'],
    hidden: (r) => [
      '1\n0\n',
      arrInput(range(200000, (i) => i)),
      arrInput(range(200000, (i) => -i)),
      arrInput(r.ints(200000, -1e9, 1e9)),
      arrInput(r.ints(200000, 0, 100)),
      arrInput(r.ints(20, 0, 10)),
    ],
    solve: (s) => {
      const [n, ...a] = nums(s);
      const tails: number[] = [];
      for (const x of a.slice(0, n)) {
        let lo = 0;
        let hi = tails.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (tails[mid]! < x) lo = mid + 1;
          else hi = mid;
        }
        tails[lo] = x;
      }
      return String(tails.length);
    },
    python: py(`
      import sys
      from bisect import bisect_left
      d = sys.stdin.buffer.read().split()
      tails = []
      for x in map(int, d[1:1 + int(d[0])]):
          i = bisect_left(tails, x)
          if i == len(tails): tails.append(x)
          else: tails[i] = x
      print(len(tails))
    `),
  },
  {
    slug: 'count-islands',
    title: 'Count Islands',
    difficulty: 'MEDIUM',
    statement: statement(
      'Count the islands in a grid. An island is a maximal group of land cells (`#`) connected horizontally or vertically.',
      'The first line contains `n m`. Each of the next `n` lines contains `m` characters, `#` (land) or `.` (water).',
      'The number of islands.',
      ['1 ≤ n, m ≤ 500'],
    ),
    samples: ['4 5\n##...\n##..#\n.....\n..###\n', '1 1\n.\n'],
    hidden: (r) => [
      '1 1\n#\n',
      `500 500\n${randomGrid(r, 500, 500, 1)}\n`,
      `500 500\n${range(500, (i) => i)
        .map((i) =>
          range(500, (j) => (i + j) % 2)
            .map((b) => (b ? '#' : '.'))
            .join(''),
        )
        .join('\n')}\n`,
      `500 500\n${randomGrid(r, 500, 500, 0.4)}\n`,
      `500 500\n${randomGrid(r, 500, 500, 0.6)}\n`,
      `20 30\n${randomGrid(r, 20, 30, 0.5)}\n`,
    ],
    solve: (s) => {
      const [head, ...rows] = lines(s);
      const [n, m] = nums(head!) as [number, number];
      const seen = new Uint8Array(n * m);
      let count = 0;
      for (let start = 0; start < n * m; start++) {
        if (seen[start] || rows[Math.floor(start / m)]![start % m] !== '#') continue;
        count++;
        const queue = [start];
        seen[start] = 1;
        for (let qi = 0; qi < queue.length; qi++) {
          const c = queue[qi]!;
          const i = Math.floor(c / m);
          const j = c % m;
          for (const [di, dj] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= n || nj >= m) continue;
            const id = ni * m + nj;
            if (!seen[id] && rows[ni]![nj] === '#') {
              seen[id] = 1;
              queue.push(id);
            }
          }
        }
      }
      return String(count);
    },
    python: py(`
      import sys
      data = sys.stdin.read().split()
      n, m = int(data[0]), int(data[1])
      parent = list(range(n * m))
      def find(x):
          while parent[x] != x:
              parent[x] = parent[parent[x]]
              x = parent[x]
          return x
      g = data[2:2 + n]
      land = 0
      for i in range(n):
          row = g[i]
          for j in range(m):
              if row[j] != '#': continue
              land += 1
              c = i * m + j
              for ni, nj in ((i - 1, j), (i, j - 1)):
                  if ni >= 0 and nj >= 0 and g[ni][nj] == '#':
                      a, b = find(c), find(ni * m + nj)
                      if a != b:
                          parent[a] = b
                          land -= 1
      print(land)
    `),
  },
  {
    slug: 'next-greater-element',
    title: 'Next Greater Element',
    difficulty: 'MEDIUM',
    statement: statement(
      'For every element, find the first element to its right that is strictly greater.',
      'The first line contains `n`. The second line contains `n` integers.',
      '`n` space-separated values: the next greater element for each position, or `-1` if there is none.',
      ['1 ≤ n ≤ 2·10^5', '0 ≤ ai ≤ 10^9'],
    ),
    samples: ['5\n2 1 2 4 3\n', '1\n5\n'],
    hidden: (r) => [
      arrInput(range(200000, (i) => i)),
      arrInput(range(200000, (i) => 200000 - i)),
      arrInput(range(200000, () => 3)),
      arrInput(r.ints(200000, 0, 1e9)),
      arrInput(r.ints(15, 0, 5)),
    ],
    solve: (s) => {
      const [n, ...rest] = nums(s);
      const a = rest.slice(0, n);
      const res = new Array<number>(n!).fill(-1);
      const stack: number[] = [];
      for (let i = 0; i < n!; i++) {
        while (stack.length && a[stack[stack.length - 1]!]! < a[i]!) res[stack.pop()!] = a[i]!;
        stack.push(i);
      }
      return res.join(' ');
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      n = int(d[0])
      a = list(map(int, d[1:1 + n]))
      res = [-1] * n
      stack = []
      for i in range(n - 1, -1, -1):
          x = a[i]
          while stack and stack[-1] <= x:
              stack.pop()
          if stack: res[i] = stack[-1]
          stack.append(x)
      print(' '.join(map(str, res)))
    `),
  },
  {
    slug: 'edit-distance',
    title: 'Edit Distance',
    difficulty: 'MEDIUM',
    statement: statement(
      'Find the minimum number of single-character insertions, deletions and substitutions that turn `s` into `t`.',
      'Two lines: `s` and `t`, each a string of lowercase letters.',
      'The edit distance.',
      ['1 ≤ |s|, |t| ≤ 1000'],
    ),
    samples: ['kitten\nsitting\n', 'abc\nabc\n'],
    hidden: (r) => {
      const base = r.word(1000, 'abcd');
      const mutated = [...base];
      for (let i = 0; i < 30; i++) mutated[r.int(0, 999)] = r.pick([...'abcd']);
      return [
        'a\nb\n',
        `${'a'.repeat(1000)}\nb\n`,
        `${r.word(1000)}\n${r.word(1000)}\n`,
        `${base}\n${mutated.join('')}\n`,
        `${r.word(1000, 'ab')}\n${r.word(700, 'ab')}\n`,
        `${r.word(8)}\n${r.word(5)}\n`,
      ];
    },
    solve: (s) => {
      const [a, b] = lines(s) as [string, string];
      let prev = range(b.length + 1, (j) => j);
      for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
          cur[j] = Math.min(
            prev[j]! + 1,
            cur[j - 1]! + 1,
            prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
          );
        }
        prev = cur;
      }
      return String(prev[b.length]);
    },
    python: py(`
      s = input().strip()
      t = input().strip()
      prev = list(range(len(t) + 1))
      for i, cs in enumerate(s, 1):
          cur = [i] + [0] * len(t)
          for j, ct in enumerate(t, 1):
              x = prev[j - 1] + (cs != ct)
              y = prev[j] + 1
              z = cur[j - 1] + 1
              cur[j] = x if x < y and x < z else (y if y < z else z)
          prev = cur
      print(prev[-1])
    `),
  },

  // ===================================== HARD ==============================================
  {
    slug: 'shortest-path',
    title: 'Shortest Path',
    difficulty: 'HARD',
    statement: statement(
      'Given a directed graph with positive edge weights, find the length of the shortest path from vertex `1` to vertex `n`.',
      'The first line contains `n m`. Each of the next `m` lines contains `u v w`: an edge from `u` to `v` with weight `w`.',
      'The shortest distance, or `-1` if `n` is unreachable.',
      ['1 ≤ n ≤ 10^5', '0 ≤ m ≤ 2·10^5', '1 ≤ w ≤ 10^9'],
    ),
    samples: ['4 5\n1 2 1\n2 4 5\n1 3 2\n3 4 1\n1 4 10\n', '3 1\n1 2 1\n'],
    hidden: (r) => {
      const randomGraph = (n: number, m: number, maxW: number) =>
        range(m, () => 0).map(() => [r.int(1, n), r.int(1, n), r.int(1, maxW)]);
      return [
        '1 0\n',
        edgeInput(
          100000,
          range(99999, (i) => i + 1).map((i) => [i, i + 1, 1e9]),
        ),
        edgeInput(100000, randomGraph(100000, 200000, 1e9)),
        edgeInput(100000, randomGraph(100000, 200000, 10)),
        edgeInput(100000, randomGraph(100000, 50000, 100)),
        edgeInput(50, randomGraph(50, 300, 20)),
      ];
    },
    solve: (s) => {
      const t = nums(s);
      const [n, m] = t as [number, number];
      const adj: [number, number][][] = range(n + 1, () => 0).map(() => []);
      for (let i = 0; i < m; i++) adj[t[2 + 3 * i]!]!.push([t[3 + 3 * i]!, t[4 + 3 * i]!]);
      const dist = new Array<number>(n + 1).fill(Infinity);
      dist[1] = 0;
      const heap = new MinHeap<[number, number]>();
      heap.push([0, 1]);
      while (heap.size) {
        const [d, u] = heap.pop()!;
        if (d > dist[u]!) continue;
        for (const [v, w] of adj[u]!) {
          if (d + w < dist[v]!) {
            dist[v] = d + w;
            heap.push([d + w, v]);
          }
        }
      }
      return String(dist[n] === Infinity ? -1 : dist[n]);
    },
    python: py(`
      import sys, heapq
      d = sys.stdin.buffer.read().split()
      n, m = int(d[0]), int(d[1])
      adj = [[] for _ in range(n + 1)]
      for i in range(m):
          u, v, w = int(d[2 + 3 * i]), int(d[3 + 3 * i]), int(d[4 + 3 * i])
          adj[u].append((v, w))
      INF = float('inf')
      dist = [INF] * (n + 1)
      dist[1] = 0
      pq = [(0, 1)]
      while pq:
          du, u = heapq.heappop(pq)
          if du > dist[u]: continue
          if u == n: break
          for v, w in adj[u]:
              nd = du + w
              if nd < dist[v]:
                  dist[v] = nd
                  heapq.heappush(pq, (nd, v))
      print(dist[n] if dist[n] != INF else -1)
    `),
  },
  {
    slug: 'count-inversions',
    title: 'Count Inversions',
    difficulty: 'HARD',
    statement: statement(
      'Count the pairs `i < j` with `a[i] > a[j]`.',
      'The first line contains `n`. The second line contains `n` integers.',
      'The number of inversions (may not fit in 32 bits).',
      ['1 ≤ n ≤ 10^5', '|ai| ≤ 10^9'],
    ),
    samples: ['5\n2 4 1 3 5\n', '3\n1 1 1\n'],
    hidden: (r) => [
      '1\n7\n',
      arrInput(range(100000, (i) => i)),
      arrInput(range(100000, (i) => 100000 - i)),
      arrInput(r.ints(100000, 0, 10)),
      arrInput(r.ints(100000, -1e9, 1e9)),
      arrInput(r.ints(12, 0, 6)),
    ],
    solve: (s) => {
      const [n, ...rest] = nums(s);
      const a = rest.slice(0, n);
      const tmp = new Array<number>(a.length);
      const sort = (lo: number, hi: number): number => {
        if (hi - lo < 2) return 0;
        const mid = (lo + hi) >> 1;
        let inv = sort(lo, mid) + sort(mid, hi);
        let i = lo;
        let j = mid;
        let k = lo;
        while (i < mid || j < hi) {
          if (j >= hi || (i < mid && a[i]! <= a[j]!)) tmp[k++] = a[i++]!;
          else {
            inv += mid - i;
            tmp[k++] = a[j++]!;
          }
        }
        for (let x = lo; x < hi; x++) a[x] = tmp[x]!;
        return inv;
      };
      return String(sort(0, a.length));
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      n = int(d[0])
      a = list(map(int, d[1:1 + n]))
      rank = {v: i + 1 for i, v in enumerate(sorted(set(a)))}
      size = len(rank)
      tree = [0] * (size + 1)
      inv = 0
      for seen, x in enumerate(a):
          r = rank[x]
          # count of previous elements <= x
          i, s = r, 0
          while i > 0:
              s += tree[i]
              i -= i & -i
          inv += seen - s
          i = r
          while i <= size:
              tree[i] += 1
              i += i & -i
      print(inv)
    `),
  },
  {
    slug: 'sliding-window-max',
    title: 'Sliding Window Maximum',
    difficulty: 'HARD',
    statement: statement(
      'For every window of `k` consecutive elements, print its maximum.',
      'The first line contains `n k`. The second line contains `n` integers.',
      '`n − k + 1` space-separated maxima, from the leftmost window to the rightmost.',
      ['1 ≤ k ≤ n ≤ 2·10^5', '|ai| ≤ 10^9'],
    ),
    samples: ['8 3\n1 3 -1 -3 5 3 6 7\n', '1 1\n5\n'],
    hidden: (r) => [
      arrInput(r.ints(200000, -1e9, 1e9), [200000, 1]),
      arrInput(r.ints(200000, -1e9, 1e9), [200000, 200000]),
      arrInput(
        range(200000, (i) => 200000 - i),
        [200000, 1000],
      ),
      arrInput(r.ints(200000, -1e9, 1e9), [200000, 1000]),
      arrInput(r.ints(200000, 0, 5), [200000, 7]),
      arrInput(r.ints(10, -5, 5), [10, 3]),
    ],
    solve: (s) => {
      const [n, k, ...rest] = nums(s);
      const a = rest.slice(0, n);
      const dq = new Int32Array(n!);
      let head = 0;
      let tail = 0;
      const out: number[] = [];
      for (let i = 0; i < n!; i++) {
        while (tail > head && a[dq[tail - 1]!]! <= a[i]!) tail--;
        dq[tail++] = i;
        if (dq[head]! <= i - k!) head++;
        if (i >= k! - 1) out.push(a[dq[head]!]!);
      }
      return out.join(' ');
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      n, k = int(d[0]), int(d[1])
      a = list(map(int, d[2:2 + n]))
      # sparse-block method: prefix max within blocks of size k and suffix max
      pre = a[:]
      suf = a[:]
      for i in range(1, n):
          if i % k and pre[i - 1] > pre[i]: pre[i] = pre[i - 1]
      for i in range(n - 2, -1, -1):
          if (i + 1) % k and suf[i + 1] > suf[i]: suf[i] = suf[i + 1]
      out = [max(suf[i], pre[i + k - 1]) for i in range(n - k + 1)]
      print(' '.join(map(str, out)))
    `),
  },
  {
    slug: 'longest-palindromic-substring',
    title: 'Longest Palindromic Substring',
    difficulty: 'HARD',
    statement: statement(
      'Find the length of the longest substring that is a palindrome.',
      'A single line containing a string of lowercase letters.',
      'The length of the longest palindromic substring.',
      ['1 ≤ length ≤ 10^5'],
    ),
    samples: ['babad\n', 'cbbd\n'],
    hidden: (r) => {
      const half = r.word(20000);
      return [
        'a\n',
        `${'a'.repeat(100000)}\n`,
        `${'ab'.repeat(50000)}\n`,
        `${r.word(40000)}${half}${[...half].reverse().join('')}${r.word(20000)}\n`,
        `${r.word(100000, 'ab')}\n`,
        `${r.word(100000)}\n`,
        `${r.word(40, 'abc')}\n`,
      ];
    },
    // Manacher on the '#'-interleaved string.
    solve: (s) => {
      const w = lines(s)[0]!;
      const t = `^#${[...w].join('#')}#$`;
      const p = new Int32Array(t.length);
      let c = 0;
      let right = 0;
      let best = 0;
      for (let i = 1; i < t.length - 1; i++) {
        if (i < right) p[i] = Math.min(right - i, p[2 * c - i]!);
        while (t[i + p[i]! + 1] === t[i - p[i]! - 1]) p[i]!++;
        if (i + p[i]! > right) {
          c = i;
          right = i + p[i]!;
        }
        best = Math.max(best, p[i]!);
      }
      return String(best);
    },
    // d1/d2 (odd/even radius) Manacher, written independently of `solve`.
    python: py(`
      s = input().strip()
      n = len(s)
      d1 = [0] * n
      l, r = 0, -1
      for i in range(n):
          k = 1 if i > r else min(d1[l + r - i], r - i + 1)
          while i - k >= 0 and i + k < n and s[i - k] == s[i + k]:
              k += 1
          d1[i] = k
          if i + k - 1 > r:
              l, r = i - k + 1, i + k - 1
      d2 = [0] * n
      l, r = 0, -1
      for i in range(n):
          k = 0 if i > r else min(d2[l + r - i + 1], r - i + 1)
          while i - k - 1 >= 0 and i + k < n and s[i - k - 1] == s[i + k]:
              k += 1
          d2[i] = k
          if i + k - 1 > r:
              l, r = i - k, i + k - 1
      print(max(max(2 * x - 1 for x in d1), max(2 * x for x in d2)))
    `),
  },
  {
    slug: 'knapsack',
    title: '0/1 Knapsack',
    difficulty: 'HARD',
    statement: statement(
      'Choose a subset of items with total weight at most `W` and maximum total value. Each item can be used at most once.',
      'The first line contains `n W`. Each of the next `n` lines contains `w v`: the weight and value of an item.',
      'The maximum total value.',
      ['1 ≤ n ≤ 100', '1 ≤ W ≤ 10^4', '1 ≤ w ≤ 10^4', '1 ≤ v ≤ 10^9'],
    ),
    samples: ['3 50\n10 60\n20 100\n30 120\n', '1 5\n10 100\n'],
    hidden: (r) => {
      const gen = (n: number, W: number, maxW: number) =>
        `${n} ${W}\n${range(n, () => 0)
          .map(() => `${r.int(1, maxW)} ${r.int(1, 1e9)}`)
          .join('\n')}\n`;
      return [
        '1 1\n1 1000000000\n',
        gen(100, 10000, 10000),
        gen(100, 10000, 200),
        gen(100, 10000, 50),
        gen(100, 1, 10000),
        gen(8, 30, 10),
      ];
    },
    solve: (s) => {
      const t = nums(s);
      const [n, W] = t as [number, number];
      const dp = new Array<number>(W + 1).fill(0);
      for (let i = 0; i < n; i++) {
        const w = t[2 + 2 * i]!;
        const v = t[3 + 2 * i]!;
        for (let c = W; c >= w; c--) dp[c] = Math.max(dp[c]!, dp[c - w]! + v);
      }
      return String(dp[W]);
    },
    python: py(`
      import sys
      d = list(map(int, sys.stdin.buffer.read().split()))
      n, W = d[0], d[1]
      dp = [0] * (W + 1)
      for i in range(n):
          w, v = d[2 + 2 * i], d[3 + 2 * i]
          if w > W: continue
          shifted = [x + v for x in dp[:W + 1 - w]]
          tail = dp[w:]
          dp[w:] = [a if a > b else b for a, b in zip(tail, shifted)]
      print(dp[W])
    `),
  },
  {
    slug: 'minimum-spanning-tree',
    title: 'Minimum Spanning Tree',
    difficulty: 'HARD',
    statement: statement(
      'Find the total weight of a minimum spanning tree of an undirected weighted graph.',
      'The first line contains `n m`. Each of the next `m` lines contains `u v w`, an undirected edge (u ≠ v). Parallel edges may appear.',
      'The total MST weight, or `-1` if the graph is not connected.',
      ['1 ≤ n ≤ 10^5', '0 ≤ m ≤ 2·10^5', '1 ≤ w ≤ 10^9'],
    ),
    samples: ['4 5\n1 2 1\n2 3 2\n3 4 3\n1 4 4\n1 3 5\n', '3 1\n1 2 5\n'],
    hidden: (r) => {
      const connected = (n: number, extra: number, maxW: number) => {
        const order = r.shuffle(range(n, (i) => i + 1));
        const edges = range(n - 1, (i) => i + 1).map((i) => [
          order[i]!,
          order[r.int(0, i - 1)]!,
          r.int(1, maxW),
        ]);
        for (let i = 0; i < extra; i++) {
          const u = r.int(1, n);
          let v = r.int(1, n);
          if (u === v) v = (v % n) + 1;
          edges.push([u, v, r.int(1, maxW)]);
        }
        return r.shuffle(edges);
      };
      return [
        '1 0\n',
        '2 0\n',
        edgeInput(100000, connected(100000, 100001, 1e9)),
        edgeInput(100000, connected(100000, 100001, 3)),
        edgeInput(100000, connected(99999, 100000, 1e9)), // vertex 100000 isolated
        edgeInput(30, connected(30, 40, 50)),
      ];
    },
    // Prim's with a heap (independent of the Kruskal reference).
    solve: (s) => {
      const t = nums(s);
      const [n, m] = t as [number, number];
      const adj: [number, number][][] = range(n + 1, () => 0).map(() => []);
      for (let i = 0; i < m; i++) {
        const [u, v, w] = [t[2 + 3 * i]!, t[3 + 3 * i]!, t[4 + 3 * i]!];
        adj[u]!.push([v, w]);
        adj[v]!.push([u, w]);
      }
      const inTree = new Uint8Array(n + 1);
      const heap = new MinHeap<[number, number]>();
      heap.push([0, 1]);
      let total = 0;
      let count = 0;
      while (heap.size) {
        const [w, u] = heap.pop()!;
        if (inTree[u]) continue;
        inTree[u] = 1;
        total += w;
        count++;
        for (const [v, wv] of adj[u]!) if (!inTree[v]) heap.push([wv, v]);
      }
      return String(count === n ? total : -1);
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      n, m = int(d[0]), int(d[1])
      edges = sorted((int(d[4 + 3 * i]), int(d[2 + 3 * i]), int(d[3 + 3 * i])) for i in range(m))
      parent = list(range(n + 1))
      def find(x):
          while parent[x] != x:
              parent[x] = parent[parent[x]]
              x = parent[x]
          return x
      total, used = 0, 0
      for w, u, v in edges:
          a, b = find(u), find(v)
          if a != b:
              parent[a] = b
              total += w
              used += 1
              if used == n - 1: break
      print(total if used == n - 1 else -1)
    `),
  },
  {
    slug: 'lexicographic-toposort',
    title: 'Smallest Topological Order',
    difficulty: 'HARD',
    statement: statement(
      'Order the tasks `1 … n` so that for every constraint `u v`, task `u` comes before task `v`. Among all valid orders, print the lexicographically smallest one.',
      'The first line contains `n m`. Each of the next `m` lines contains `u v` (u ≠ v). Constraints may repeat.',
      'The `n` tasks in order, space-separated, or `-1` if no valid order exists.',
      ['1 ≤ n ≤ 10^5', '0 ≤ m ≤ 2·10^5'],
    ),
    samples: ['4 3\n2 1\n3 1\n4 3\n', '2 2\n1 2\n2 1\n'],
    hidden: (r) => {
      const dag = randomDag(r, 100000, 200000);
      const cyclic = [...dag, [dag[777]![1], dag[777]![0]] as [number, number]];
      return [
        '5 0\n',
        edgeInput(
          100000,
          range(99999, (i) => i + 1).map((i) => [i + 1, i]),
        ),
        edgeInput(100000, dag),
        edgeInput(100000, r.shuffle(cyclic)),
        edgeInput(100000, randomDag(r, 100000, 1000)),
        edgeInput(12, randomDag(r, 12, 15)),
      ];
    },
    solve: (s) => {
      const t = nums(s);
      const [n, m] = t as [number, number];
      const adj: number[][] = range(n + 1, () => 0).map(() => []);
      const indeg = new Int32Array(n + 1);
      for (let i = 0; i < m; i++) {
        adj[t[2 + 2 * i]!]!.push(t[3 + 2 * i]!);
        indeg[t[3 + 2 * i]!]!++;
      }
      const heap = new MinHeap<[number]>();
      for (let v = 1; v <= n; v++) if (!indeg[v]) heap.push([v]);
      const order: number[] = [];
      while (heap.size) {
        const [u] = heap.pop()!;
        order.push(u);
        for (const v of adj[u]!) if (--indeg[v]! === 0) heap.push([v]);
      }
      return order.length === n ? order.join(' ') : '-1';
    },
    python: py(`
      import sys, heapq
      d = sys.stdin.buffer.read().split()
      n, m = int(d[0]), int(d[1])
      adj = [[] for _ in range(n + 1)]
      indeg = [0] * (n + 1)
      for i in range(m):
          u, v = int(d[2 + 2 * i]), int(d[3 + 2 * i])
          adj[u].append(v)
          indeg[v] += 1
      pq = [v for v in range(1, n + 1) if indeg[v] == 0]
      heapq.heapify(pq)
      order = []
      while pq:
          u = heapq.heappop(pq)
          order.append(u)
          for v in adj[u]:
              indeg[v] -= 1
              if indeg[v] == 0:
                  heapq.heappush(pq, v)
      print(' '.join(map(str, order)) if len(order) == n else -1)
    `),
  },
  {
    slug: 'largest-rectangle',
    title: 'Largest Rectangle in Histogram',
    difficulty: 'HARD',
    statement: statement(
      'Bars of width 1 stand side by side with the given heights. Find the area of the largest axis-aligned rectangle that fits entirely under the bars.',
      'The first line contains `n`. The second line contains `n` heights.',
      'The largest area (may not fit in 32 bits).',
      ['1 ≤ n ≤ 2·10^5', '0 ≤ hi ≤ 10^9'],
    ),
    samples: ['6\n2 1 5 6 2 3\n', '1\n0\n'],
    hidden: (r) => [
      '1\n1000000000\n',
      arrInput(range(200000, () => 1e9)),
      arrInput(range(200000, (i) => i)),
      arrInput(range(200000, (i) => 200000 - i)),
      arrInput(r.ints(200000, 0, 1e9)),
      arrInput(r.ints(200000, 0, 10)),
      arrInput(r.ints(10, 0, 8)),
    ],
    solve: (s) => {
      const [n, ...rest] = nums(s);
      const h = [...rest.slice(0, n), 0];
      const stack: number[] = [];
      let best = 0;
      for (let i = 0; i < h.length; i++) {
        while (stack.length && h[stack[stack.length - 1]!]! >= h[i]!) {
          const height = h[stack.pop()!]!;
          const left = stack.length ? stack[stack.length - 1]! + 1 : 0;
          best = Math.max(best, height * (i - left));
        }
        stack.push(i);
      }
      return String(best);
    },
    python: py(`
      import sys
      d = sys.stdin.buffer.read().split()
      n = int(d[0])
      h = list(map(int, d[1:1 + n]))
      left = [0] * n
      right = [n] * n
      st = []
      for i in range(n):
          while st and h[st[-1]] >= h[i]:
              right[st.pop()] = i
          left[i] = st[-1] + 1 if st else 0
          st.append(i)
      print(max(h[i] * (right[i] - left[i]) for i in range(n)))
    `),
  },
];
