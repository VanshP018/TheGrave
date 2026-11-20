import { arrInput, lines, nums, py, range, statement, type ProblemDef } from './problems.js';

/** Original easy problems: each has a worked example in the statement, 2 samples and 5-6 hidden tests. */
export const easyProblems: ProblemDef[] = [
  {
    slug: 'peak-elements',
    title: 'Count the Peaks',
    difficulty: 'EASY',
    statement: statement(
      `A hiker records the altitude at \`n\` consecutive checkpoints along a ridge. Checkpoint \`i\` is a **peak** if its altitude is **strictly greater** than the altitude of every checkpoint adjacent to it. The first checkpoint only has a right neighbour and the last one only has a left neighbour. If there is just one checkpoint, it is a peak.

For example, for altitudes \`1 3 2 2 5 4\` the peaks are the 2nd checkpoint (3 > 1 and 3 > 2) and the 5th checkpoint (5 > 2 and 5 > 4). The 3rd and 4th checkpoints have equal altitudes, so neither is a peak. The answer is 2.

Count the peaks.`,
      'The first line contains `n`. The second line contains `n` integers `a1 … an`, the altitudes.',
      'Print one integer: the number of peaks.',
      ['1 ≤ n ≤ 2·10^5', '|ai| ≤ 10^9'],
    ),
    samples: ['6\n1 3 2 2 5 4\n', '1\n7\n'],
    hidden: (r) => [
      '1\n-1000000000\n',
      arrInput(range(1000, () => 5)),
      arrInput(range(200000, (i) => i)),
      arrInput(range(200000, (i) => (i % 2 === 0 ? 10 : 1))),
      arrInput(r.ints(1000, 0, 3)),
      arrInput(r.ints(200000, -1e9, 1e9)),
    ],
    solve: (s) => {
      const [n, ...rest] = nums(s);
      const a = rest.slice(0, n);
      let peaks = 0;
      for (let i = 0; i < a.length; i++) {
        const leftOk = i === 0 || a[i]! > a[i - 1]!;
        const rightOk = i === a.length - 1 || a[i]! > a[i + 1]!;
        if (leftOk && rightOk) peaks++;
      }
      return String(peaks);
    },
    python: py(`
      import sys
      d = sys.stdin.read().split()
      n = int(d[0])
      a = list(map(int, d[1:1 + n]))
      inf = float('inf')
      b = [-inf] + a + [-inf]
      print(sum(1 for i in range(1, n + 1) if b[i] > b[i - 1] and b[i] > b[i + 1]))
    `),
  },
  {
    slug: 'run-length-encode',
    title: 'Run-Length Encoding',
    difficulty: 'EASY',
    statement: statement(
      `Run-length encoding compresses a string by replacing every **maximal block of identical consecutive letters** with the letter followed by the length of the block, written in decimal. Blocks are written one after another with no separators.

For example, \`aaabccdddd\` consists of the blocks \`aaa\`, \`b\`, \`cc\`, \`dddd\`, so its encoding is \`a3b1c2d4\`. A single letter still gets a count: \`z\` is encoded as \`z1\`.

Print the run-length encoding of the given string.`,
      'A single line containing a string `s` of lowercase English letters.',
      'The run-length encoding of `s`.',
      ['1 ≤ |s| ≤ 10^5'],
    ),
    samples: ['aaabccdddd\n', 'z\n'],
    hidden: (r) => [
      `${'a'.repeat(100000)}\n`,
      `${'ab'.repeat(50000)}\n`,
      `${r.word(100000, 'ab')}\n`,
      `${r.word(20, 'abc')}\n`,
      'aabbaabbaabb\n',
      `${r.word(100000)}\n`,
    ],
    solve: (s) => {
      const t = lines(s)[0]!;
      let out = '';
      for (let i = 0; i < t.length;) {
        let j = i;
        while (j < t.length && t[j] === t[i]) j++;
        out += t[i] + String(j - i);
        i = j;
      }
      return out;
    },
    python: py(`
      import sys
      from itertools import groupby
      s = sys.stdin.readline().strip()
      print(''.join(c + str(len(list(g))) for c, g in groupby(s)))
    `),
  },
  {
    slug: 'rotate-right',
    title: 'Rotate the Carousel',
    difficulty: 'EASY',
    statement: statement(
      `A carousel has \`n\` seats in a circle, and seat \`i\` currently holds the person with number \`ai\`. The carousel is turned so that every person moves \`k\` seats forward: the person in seat \`i\` ends up in seat \`i + k\`, and the last seats wrap around to the front.

For example, turning \`1 2 3 4 5\` by \`k = 2\` gives \`4 5 1 2 3\`. Turning a carousel by exactly \`n\` seats brings everybody back where they started.

Print the arrangement after the turn.`,
      'The first line contains `n k`. The second line contains `n` integers `a1 … an`.',
      'Print `n` space-separated integers: the arrangement after rotating right by `k` seats.',
      ['1 ≤ n ≤ 2·10^5', '0 ≤ k ≤ 10^9', '|ai| ≤ 10^9'],
    ),
    samples: ['5 2\n1 2 3 4 5\n', '3 3\n7 8 9\n'],
    hidden: (r) => [
      arrInput([42], [1, 999999999]),
      arrInput([1, 2, 3, 4, 5, 6, 7], [7, 0]),
      arrInput([1, 2, 3, 4, 5, 6, 7], [7, 1000000000]),
      arrInput(r.ints(200000, -1e9, 1e9), [200000, r.int(1, 1e9)]),
      arrInput(r.ints(200000, -1e9, 1e9), [200000, 199999]),
      arrInput(r.ints(10, -9, 9), [10, 23]),
    ],
    solve: (s) => {
      const [n, k0, ...rest] = nums(s);
      const a = rest.slice(0, n);
      const k = k0! % n!;
      return [...a.slice(n! - k), ...a.slice(0, n! - k)].join(' ');
    },
    python: py(`
      import sys
      from collections import deque
      d = sys.stdin.read().split()
      n, k = int(d[0]), int(d[1])
      q = deque(map(int, d[2:2 + n]))
      q.rotate(k % n)
      print(' '.join(map(str, q)))
    `),
  },
  {
    slug: 'closest-to-zero',
    title: 'Closest to Zero',
    difficulty: 'EASY',
    statement: statement(
      `A thermometer log contains \`n\` temperature readings. Find the reading that is **closest to zero**, that is, the one with the smallest absolute value.

If two readings are equally close to zero (they are \`x\` and \`-x\` for some \`x\`), report the **positive** one. If the closest reading is \`0\`, report \`0\`.

For example, in \`-4 -2 1 4 6\` the closest reading is \`1\`. In \`-3 3 8 9\` the readings \`-3\` and \`3\` tie, so the answer is \`3\`.`,
      'The first line contains `n`. The second line contains `n` integers `a1 … an`.',
      'Print the reading closest to zero, using the tie-break above.',
      ['1 ≤ n ≤ 2·10^5', '|ai| ≤ 10^9'],
    ),
    samples: ['5\n-4 -2 1 4 6\n', '4\n-3 3 8 9\n'],
    hidden: (r) => [
      '1\n-1000000000\n',
      '2\n-5 5\n',
      '5\n9 -7 0 3 -1\n',
      arrInput(range(1000, () => -r.int(1, 1e9))),
      arrInput(r.ints(1000, -5, 5)),
      arrInput(r.ints(200000, -1e9, 1e9)),
    ],
    solve: (s) => {
      const [n, ...rest] = nums(s);
      const a = rest.slice(0, n);
      let best = a[0]!;
      for (const x of a) {
        if (Math.abs(x) < Math.abs(best) || (Math.abs(x) === Math.abs(best) && x > best)) best = x;
      }
      return String(best);
    },
    python: py(`
      import sys
      d = sys.stdin.read().split()
      n = int(d[0])
      a = list(map(int, d[1:1 + n]))
      print(min(a, key=lambda x: (abs(x), -x)))
    `),
  },
  {
    slug: 'digit-sum-steps',
    title: 'Digit Sum Descent',
    difficulty: 'EASY',
    statement: statement(
      `Start with a non-negative integer \`N\`. In one **step**, replace the number by the sum of its decimal digits. Repeat until the number has only one digit. How many steps does it take?

For example, \`38\` becomes \`3 + 8 = 11\`, which becomes \`1 + 1 = 2\`, so it takes **2** steps. A number that already has a single digit, such as \`7\`, takes **0** steps.

\`N\` can be enormous, so it is given as a string of digits.`,
      'A single line containing the decimal digits of `N` (no leading zeros, except that `N = 0` is written `0`).',
      'Print the number of steps.',
      ['1 ≤ number of digits ≤ 10^5'],
    ),
    samples: ['38\n', '7\n'],
    hidden: (r) => [
      '0\n',
      '99\n',
      `${'9'.repeat(100000)}\n`,
      `1${'0'.repeat(99999)}\n`,
      `${r.int(1, 9)}${r.word(19, '0123456789')}\n`,
      `${r.int(1, 9)}${r.word(99999, '0123456789')}\n`,
    ],
    solve: (s) => {
      const t = lines(s)[0]!;
      let steps = 0;
      let cur = t;
      while (cur.length > 1) {
        let sum = 0;
        for (const c of cur) sum += c.charCodeAt(0) - 48;
        cur = String(sum);
        steps++;
      }
      return String(steps);
    },
    python: py(`
      s = input().strip()
      steps = 0
      while len(s) > 1:
          s = str(sum(map(int, s)))
          steps += 1
      print(steps)
    `),
  },
  {
    slug: 'longest-common-prefix',
    title: 'Longest Common Prefix',
    difficulty: 'EASY',
    statement: statement(
      `You are given \`n\` words. A **common prefix** is a string that every word starts with. Find the **longest** common prefix of all the words. If the words share no common first letter, the longest common prefix is empty; in that case print \`NONE\`.

For example, \`flower\`, \`flow\` and \`flight\` all start with \`fl\`, and nothing longer is shared, so the answer is \`fl\`. The words \`dog\` and \`car\` share nothing, so the answer is \`NONE\`.`,
      'The first line contains `n`. Each of the next `n` lines contains one word of lowercase English letters.',
      'Print the longest common prefix, or `NONE` if it is empty.',
      ['1 ≤ n ≤ 1000', 'each word has length between 1 and 200'],
    ),
    samples: ['3\nflower\nflow\nflight\n', '2\ndog\ncar\n'],
    hidden: (r) => {
      const word = (len: number) => r.word(len, 'ab');
      return [
        '1\nsingleword\n',
        `1000\n${range(1000, () => 'abcabcabc'.repeat(20)).join('\n')}\n`,
        `5\n${range(5, () => `abc${word(r.int(0, 50))}`).join('\n')}\n`,
        `4\nabcdef\nabc\nabcxyz\nab\n`,
        `6\n${range(6, () => word(r.int(1, 200))).join('\n')}\n`,
        `1000\n${range(1000, () => `q${word(r.int(0, 199))}`).join('\n')}\n`,
      ];
    },
    solve: (s) => {
      const [first, ...rest] = lines(s);
      const n = Number(first);
      const words = rest.slice(0, n);
      let prefix = words[0]!;
      for (const w of words) {
        let i = 0;
        while (i < prefix.length && i < w.length && prefix[i] === w[i]) i++;
        prefix = prefix.slice(0, i);
      }
      return prefix === '' ? 'NONE' : prefix;
    },
    python: py(`
      import sys
      import os.path
      ws = sys.stdin.read().split()
      n = int(ws[0])
      p = os.path.commonprefix(ws[1:1 + n])
      print(p if p else 'NONE')
    `),
  },
  {
    slug: 'unique-once-count',
    title: 'Appears Exactly Once',
    difficulty: 'EASY',
    statement: statement(
      `A library scanner reads the ID badge of every visitor in a day. Some visitors come back several times. Count how many **distinct IDs appear exactly once** in the log.

For example, in the log \`1 2 2 3 4 4 5\` the IDs 1, 3 and 5 each appear exactly once, while 2 and 4 appear twice, so the answer is 3. In the log \`9 9 9\` no ID appears exactly once, so the answer is 0.`,
      'The first line contains `n`. The second line contains `n` integers `a1 … an`, the scanned IDs.',
      'Print the number of IDs that appear exactly once.',
      ['1 ≤ n ≤ 2·10^5', '|ai| ≤ 10^9'],
    ),
    samples: ['7\n1 2 2 3 4 4 5\n', '3\n9 9 9\n'],
    hidden: (r) => [
      '1\n-5\n',
      arrInput(r.shuffle(range(200000, (i) => i * 3 - 100000))),
      arrInput(range(200000, () => 7)),
      arrInput(r.ints(200000, 0, 1000)),
      arrInput(r.ints(200000, -1e9, 1e9)),
      arrInput(r.ints(12, 1, 6)),
    ],
    solve: (s) => {
      const [n, ...rest] = nums(s);
      const count = new Map<number, number>();
      for (const x of rest.slice(0, n)) count.set(x, (count.get(x) ?? 0) + 1);
      let once = 0;
      for (const c of count.values()) if (c === 1) once++;
      return String(once);
    },
    python: py(`
      import sys
      from collections import Counter
      d = sys.stdin.buffer.read().split()
      n = int(d[0])
      c = Counter(d[1:1 + n])
      print(sum(1 for v in c.values() if v == 1))
    `),
  },
  {
    slug: 'stair-ways',
    title: 'Climbing the Tower',
    difficulty: 'EASY',
    statement: statement(
      `A tower has \`n\` steps. You start on the ground (step 0) and want to reach step \`n\`. In one move you may climb **1, 2 or 3 steps**. Two ways are different if the sequences of move sizes differ.

For example, with \`n = 4\` there are 7 ways: \`1+1+1+1\`, \`1+1+2\`, \`1+2+1\`, \`2+1+1\`, \`2+2\`, \`1+3\`, \`3+1\`.

The number of ways can be huge, so print it modulo \`1 000 000 007\`.`,
      'A single integer `n`.',
      'Print the number of ways to reach step `n`, modulo 1000000007.',
      ['1 ≤ n ≤ 10^6'],
    ),
    samples: ['4\n', '1\n'],
    hidden: () => ['2\n', '3\n', '50\n', '100000\n', '999999\n', '1000000\n'],
    solve: (s) => {
      const n = nums(s)[0]!;
      const MOD = 1_000_000_007;
      const f = [1, 1, 2];
      for (let i = 3; i <= n; i++) f[i] = (f[i - 1]! + f[i - 2]! + f[i - 3]!) % MOD;
      return String(f[n]);
    },
    python: py(`
      MOD = 10**9 + 7
      n = int(input())

      def mul(A, B):
          return [[sum(A[i][k] * B[k][j] for k in range(3)) % MOD for j in range(3)] for i in range(3)]

      # state vector (f(i), f(i-1), f(i-2)); start at i = 2: (2, 1, 1)
      M = [[1, 1, 1], [1, 0, 0], [0, 1, 0]]
      R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
      e = max(n - 2, 0)
      while e:
          if e & 1: R = mul(R, M)
          M = mul(M, M)
          e >>= 1
      base = [2, 1, 1]
      f = [1, 1, 2]
      print(f[n] if n < 3 else sum(R[0][j] * base[j] for j in range(3)) % MOD)
    `),
  },
  {
    slug: 'binary-gap',
    title: 'Longest Zero Gap',
    difficulty: 'EASY',
    statement: statement(
      `Write a positive integer \`N\` in binary (without leading zeros). A **gap** is a maximal block of consecutive \`0\` bits that has a \`1\` bit on **both** sides. Zeros at the very end of the number (trailing zeros) are *not* part of a gap because nothing follows them.

For example, \`1041\` is \`10000010001\` in binary. It has two gaps, of lengths 5 and 3, so the answer is 5. The number \`32\` is \`100000\`, whose only zeros are trailing, so the answer is 0.

Print the length of the longest gap, or 0 if there is none.`,
      'A single integer `N`.',
      'Print the length of the longest gap.',
      ['1 ≤ N ≤ 10^18'],
    ),
    samples: ['1041\n', '32\n'],
    hidden: () => [
      '1\n',
      '5\n',
      '1023\n',
      '576460752303423489\n',
      '1000000000000000000\n',
      '999999999999999999\n',
    ],
    solve: (s) => {
      const bits = BigInt(lines(s)[0]!).toString(2);
      let best = 0;
      let run = 0;
      let seenOne = false;
      for (const c of bits) {
        if (c === '1') {
          if (seenOne) best = Math.max(best, run);
          seenOne = true;
          run = 0;
        } else run++;
      }
      return String(best);
    },
    python: py(`
      n = int(input())
      parts = bin(n)[2:].split('1')
      # parts between two ones are the gaps; the first piece is empty and the last one is the trailing zeros
      print(max((len(p) for p in parts[1:-1]), default=0))
    `),
  },
];
