import type { Language } from '@thegrave/shared';
import { describe, expect, it } from 'vitest';
import { DockerExecutor } from '../src/judge/docker-executor.js';
import { effectiveTimeLimitMs } from '../src/judge/executor.js';
import {
  functionSection,
  SIGNATURES,
  starterCodeFor,
  withDriver,
} from '../src/judge/signatures.js';
import { buildTestCases } from '../src/seed/build.js';
import { problems } from '../src/seed/problems.js';
import { extraProblems } from '../src/seed/problems-extra.js';

// Players implement solve(...) only; a hidden driver parses the stdin test data and prints the answer.
const exec = new DockerExecutor({ image: 'thegrave-judge:latest' });
// Every DSA problem, old and new, runs through the same fixed `solve(...)` setup.
const everything = [...problems, ...extraProblems];
const def = (slug: string) => everything.find((p) => p.slug === slug)!;

async function judge(slug: string, language: Language, code: string) {
  const p = def(slug);
  return exec.run(language, withDriver(slug, language, code), buildTestCases(p), {
    timeLimitMs: effectiveTimeLimitMs(p.timeLimitMs ?? 1000, language),
    memoryLimitMb: 256,
  });
}
const failures = (res: Awaited<ReturnType<typeof judge>>) =>
  res.tests
    .filter((t) => t.verdict !== 'ACCEPTED')
    .map((t) => `#${t.index} ${t.verdict} ${t.stderr.slice(-300)}`)
    .concat(res.compileOutput ? [res.compileOutput.slice(0, 600)] : []);

describe('signatures', () => {
  it('cover exactly the problem set', () => {
    expect(Object.keys(SIGNATURES).sort()).toEqual(everything.map((p) => p.slug).sort());
  });

  it('starter code is a bare function: no input handling', () => {
    for (const p of everything) {
      const s = starterCodeFor(p.slug)!;
      expect(s.python, p.slug).toContain('def solve(');
      expect(s.python, p.slug).not.toMatch(/sys\.stdin|input\(/);
      expect(s.cpp, p.slug).toContain(' solve(');
      expect(s.cpp, p.slug).not.toMatch(/\bcin\b|main\s*\(/);
      expect(functionSection(p.slug), p.slug).toContain('Implement `solve(');
    }
  });

  it('judges a full stdin program as written (older style keeps working)', () => {
    const full = 'import sys\nprint(sum(map(int, sys.stdin.read().split()[1:])))\n';
    expect(withDriver('sum-of-array', 'python', full)).toBe(full);
    expect(withDriver('sum-of-array', 'python', 'print(0)\n')).toBe('print(0)\n');
    expect(withDriver('sum-of-array', 'python', 'def solve(a):\n    return 0\n')).toContain(
      '_grader_main()',
    );
    const cpp = '#include <bits/stdc++.h>\nint main() { return 0; }\n';
    expect(withDriver('sum-of-array', 'cpp', cpp)).toBe(cpp);
  });
});

// Real solutions in both languages across the input/output shapes.
// The player's C++ starts from the starter's header, so the solutions below do too.
const CPP_HEADER = '#include <bits/stdc++.h>\nusing namespace std;\n\n';

const SOLUTIONS: Record<string, { python: string; cpp: string }> = {
  'sum-of-array': {
    python: 'def solve(a):\n    return sum(a)\n',
    cpp: 'long long solve(const vector<long long>& a) { long long s = 0; for (auto x : a) s += x; return s; }\n',
  },
  'reverse-words': {
    python: 'def solve(s):\n    return " ".join(reversed(s.split()))\n',
    cpp: `string solve(string s) {
  istringstream is(s); vector<string> w; string x;
  while (is >> x) w.push_back(x);
  string r;
  for (int i = (int)w.size() - 1; i >= 0; --i) { r += w[i]; if (i) r += ' '; }
  return r;
}\n`,
  },
  fizzbuzz: {
    python:
      'def solve(n):\n    return ["FizzBuzz" if i % 15 == 0 else "Fizz" if i % 3 == 0 else "Buzz" if i % 5 == 0 else str(i) for i in range(1, n + 1)]\n',
    cpp: `vector<string> solve(int n) {
  vector<string> r;
  for (int i = 1; i <= n; ++i) r.push_back(i % 15 == 0 ? "FizzBuzz" : i % 3 == 0 ? "Fizz" : i % 5 == 0 ? "Buzz" : to_string(i));
  return r;
}\n`,
  },
  'second-largest': {
    python: 'def solve(a):\n    d = sorted(set(a))\n    return d[-2] if len(d) > 1 else None\n',
    cpp: `optional<long long> solve(vector<long long> a) {
  sort(a.begin(), a.end()); a.erase(unique(a.begin(), a.end()), a.end());
  if (a.size() < 2) return nullopt;
  return a[a.size() - 2];
}\n`,
  },
  'palindrome-check': {
    python: 'def solve(s):\n    return s == s[::-1]\n',
    cpp: 'bool solve(string s) { return s == string(s.rbegin(), s.rend()); }\n',
  },
  'range-sum-queries': {
    python:
      'def solve(a, queries):\n    p = [0]\n    for x in a:\n        p.append(p[-1] + x)\n    return [p[r] - p[l - 1] for l, r in queries]\n',
    // vector<int> parameters: the driver adapts the parsed data to the player's types.
    cpp: `vector<long long> solve(vector<int>& a, vector<vector<int>> queries) {
  vector<long long> p(a.size() + 1, 0), r;
  for (size_t i = 0; i < a.size(); ++i) p[i + 1] = p[i] + a[i];
  for (auto& q : queries) r.push_back(p[q[1]] - p[q[0] - 1]);
  return r;
}\n`,
  },
  'merge-intervals': {
    python:
      'def solve(intervals):\n    out = []\n    for l, r in sorted(intervals):\n        if out and l <= out[-1][1]:\n            out[-1][1] = max(out[-1][1], r)\n        else:\n            out.append([l, r])\n    return out\n',
    cpp: `vector<vector<long long>> solve(vector<vector<long long>> iv) {
  sort(iv.begin(), iv.end());
  vector<vector<long long>> out;
  for (auto& x : iv) {
    if (!out.empty() && x[0] <= out.back()[1]) out.back()[1] = max(out.back()[1], x[1]);
    else out.push_back(x);
  }
  return out;
}\n`,
  },
  'grid-paths': {
    python: `def solve(grid):
    MOD = 10**9 + 7
    n, m = len(grid), len(grid[0])
    prev = [0] * (m + 1)
    for i in range(n):
        cur = [0] * (m + 1)
        for j in range(m):
            if grid[i][j] == ".":
                v = prev[j + 1] + cur[j]
                if i == 0 and j == 0:
                    v = 1
                cur[j + 1] = v % MOD
        prev = cur
    return prev[m]
`,
    cpp: `long long solve(const vector<string>& g) {
  const long long MOD = 1e9 + 7;
  int n = g.size(), m = g[0].size();
  vector<long long> prev(m + 1, 0);
  for (int i = 0; i < n; ++i) {
    vector<long long> cur(m + 1, 0);
    for (int j = 0; j < m; ++j) if (g[i][j] == '.') {
      long long v = prev[j + 1] + cur[j];
      if (i == 0 && j == 0) v = 1;
      cur[j + 1] = v % MOD;
    }
    prev = cur;
  }
  return prev[m];
}\n`,
  },
  'shortest-path': {
    python: `import heapq


def solve(n, edges):
    adj = [[] for _ in range(n + 1)]
    for u, v, w in edges:
        adj[u].append((v, w))
    INF = float("inf")
    dist = [INF] * (n + 1)
    dist[1] = 0
    pq = [(0, 1)]
    while pq:
        du, u = heapq.heappop(pq)
        if du > dist[u]:
            continue
        for v, w in adj[u]:
            if du + w < dist[v]:
                dist[v] = du + w
                heapq.heappush(pq, (dist[v], v))
    return dist[n] if dist[n] != INF else -1
`,
    cpp: `long long solve(int n, vector<vector<int>> edges) {
  vector<vector<pair<int, long long>>> adj(n + 1);
  for (auto& e : edges) adj[e[0]].push_back({e[1], e[2]});
  const long long INF = LLONG_MAX;
  vector<long long> dist(n + 1, INF);
  priority_queue<pair<long long, int>, vector<pair<long long, int>>, greater<>> pq;
  dist[1] = 0; pq.push({0, 1});
  while (!pq.empty()) {
    auto [d, u] = pq.top(); pq.pop();
    if (d > dist[u]) continue;
    for (auto [v, w] : adj[u]) if (d + w < dist[v]) { dist[v] = d + w; pq.push({dist[v], v}); }
  }
  return dist[n] == INF ? -1 : dist[n];
}\n`,
  },
  'lexicographic-toposort': {
    python: `import heapq


def solve(n, constraints):
    adj = [[] for _ in range(n + 1)]
    indeg = [0] * (n + 1)
    for u, v in constraints:
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
    return order if len(order) == n else [-1]
`,
    cpp: `vector<long long> solve(int n, vector<vector<int>> c) {
  vector<vector<int>> adj(n + 1); vector<int> indeg(n + 1, 0);
  for (auto& e : c) { adj[e[0]].push_back(e[1]); indeg[e[1]]++; }
  priority_queue<int, vector<int>, greater<>> pq;
  for (int v = 1; v <= n; ++v) if (!indeg[v]) pq.push(v);
  vector<long long> order;
  while (!pq.empty()) { int u = pq.top(); pq.pop(); order.push_back(u); for (int v : adj[u]) if (--indeg[v] == 0) pq.push(v); }
  if ((int)order.size() != n) return {-1};
  return order;
}\n`,
  },
};

describe('function-style solutions are ACCEPTED', () => {
  for (const [slug, code] of Object.entries(SOLUTIONS))
    for (const language of ['python', 'cpp'] as const)
      it(`${slug} (${language})`, async () => {
        const src = language === 'cpp' ? CPP_HEADER + code.cpp : code.python;
        expect(failures(await judge(slug, language, src))).toEqual([]);
      });
});

// Every problem: the untouched C++ starter (returns a default) must compile and run through the driver, so a
// parsing or type error in any of the 70 drivers shows up here as COMPILE_ERROR / RUNTIME_ERROR.
describe('every driver compiles and runs on its starter', () => {
  // Compiled a few at a time: dozens of simultaneous g++ runs on a small machine hit the compile timeout.
  it('all 70', { timeout: 900_000 }, async () => {
    const bad: string[] = [];
    for (let i = 0; i < everything.length; i += 4) {
      await Promise.all(
        everything.slice(i, i + 4).map(async (p) => {
          const res = await judge(p.slug, 'cpp', starterCodeFor(p.slug)!.cpp);
          if (res.compileOutput) bad.push(`${p.slug}: ${res.compileOutput.slice(0, 400)}`);
          for (const t of res.tests)
            if (t.verdict === 'RUNTIME_ERROR' || t.verdict === 'COMPILE_ERROR')
              bad.push(`${p.slug} #${t.index} ${t.verdict} ${t.stderr.slice(-200)}`);
        }),
      );
    }
    expect(bad).toEqual([]);
  });
});
