import type { Language } from '@thegrave/shared';
import { describe, expect, it, vi } from 'vitest';
import { DockerExecutor } from '../src/judge/docker-executor.js';
import { effectiveTimeLimitMs } from '../src/judge/executor.js';
import { SIGNATURES, withDriver } from '../src/judge/signatures.js';
import { buildTestCases } from '../src/seed/build.js';
import { extraProblems } from '../src/seed/problems-extra.js';
import type { ProblemDef } from '../src/seed/problems.js';

// The second batch of problems (problems-easy/-medium/-hard) goes through the same hidden driver as the first:
// players implement solve(...) only. Python is checked on every problem by an adapter; C++ on the input and
// output shapes that differ (word lists, n - 1 edge rows, query matrices, boolean and decimal answers).
vi.setConfig({ maxConcurrency: 3 });
const exec = new DockerExecutor({ image: 'thegrave-judge:latest' });

async function judge(p: ProblemDef, language: Language, code: string, headroom = 1) {
  return exec.run(language, withDriver(p.slug, language, code), buildTestCases(p), {
    timeLimitMs: effectiveTimeLimitMs(p.timeLimitMs ?? 1000, language) * headroom,
    memoryLimitMb: 256,
  });
}
const failures = (res: Awaited<ReturnType<typeof judge>>) =>
  res.tests
    .filter((t) => t.verdict !== 'ACCEPTED')
    .map((t) => `#${t.index} ${t.verdict} ${t.stderr.slice(-300)}`)
    .concat(res.compileOutput ? [res.compileOutput.slice(0, 600)] : []);

/**
 * For each problem, a Python expression that rebuilds the raw stdin text from solve's already-parsed
 * arguments (J joins a list, M joins a matrix). The adapter feeds that text to the problem's independent
 * reference program and returns what it printed. If the hidden driver parsed the input wrongly, or printed
 * the answer in the wrong shape, the rebuilt text or the answer would differ and a test would fail.
 */
const REBUILD: Record<string, string> = {
  'peak-elements': `f"{len(a)}\\n{J(a)}\\n"`,
  'run-length-encode': `s + "\\n"`,
  'rotate-right': `f"{len(a)} {k}\\n{J(a)}\\n"`,
  'closest-to-zero': `f"{len(a)}\\n{J(a)}\\n"`,
  'digit-sum-steps': `s + "\\n"`,
  'longest-common-prefix': `f"{len(words)}\\n" + "\\n".join(words) + "\\n"`,
  'unique-once-count': `f"{len(a)}\\n{J(a)}\\n"`,
  'stair-ways': `f"{n}\\n"`,
  'binary-gap': `f"{n}\\n"`,
  'subarray-sum-k': `f"{len(a)} {k}\\n{J(a)}\\n"`,
  'product-except-self': `f"{len(a)}\\n{J(a)}\\n"`,
  'shortest-substring-all-chars': `s + "\\n"`,
  'meeting-rooms-min': `f"{len(meetings)}\\n{M(meetings)}\\n"`,
  'search-rotated-array': `f"{len(shelf)} {len(queries)}\\n{J(shelf)}\\n{J(queries)}\\n"`,
  'ship-capacity': `f"{len(weights)} {days}\\n{J(weights)}\\n"`,
  'min-jumps': `f"{len(a)}\\n{J(a)}\\n"`,
  'provinces-count': `f"{n} {len(roads)}\\n" + (M(roads) + "\\n" if roads else "")`,
  'bipartite-check': `f"{n} {len(rivalries)}\\n" + (M(rivalries) + "\\n" if rivalries else "")`,
  'word-break-count': `f"{len(words)}\\n" + "\\n".join(words) + f"\\n{s}\\n"`,
  'house-robber-circular': `f"{len(a)}\\n{J(a)}\\n"`,
  'partition-equal-subset': `f"{len(a)}\\n{J(a)}\\n"`,
  'top-k-frequent': `f"{len(a)} {k}\\n{J(a)}\\n"`,
  'tree-diameter': `f"{n}\\n" + (M(cables) + "\\n" if cables else "")`,
  'lca-queries': `f"{n} {len(queries)}\\n" + (M(links) + "\\n" if links else "") + M(queries) + "\\n"`,
  'gas-station': `f"{len(gas)}\\n{J(gas)}\\n{J(cost)}\\n"`,
  'max-product-subarray': `f"{len(a)}\\n{J(a)}\\n"`,
  'longest-subarray-diff': `f"{len(a)} {k}\\n{J(a)}\\n"`,
  'pattern-occurrences': `f"{t}\\n{p}\\n"`,
  'longest-valid-parens': `s + "\\n"`,
  'lcs-length': `f"{a}\\n{b}\\n"`,
  'min-palindrome-cuts': `s + "\\n"`,
  'k-edge-shortest-path': `f"{n} {len(flights)} {k}\\n" + (M(flights) + "\\n" if flights else "")`,
  'scc-count': `f"{n} {len(roads)}\\n" + (M(roads) + "\\n" if roads else "")`,
  'bridge-count': `f"{n} {len(cables)}\\n" + (M(cables) + "\\n" if cables else "")`,
  'count-paths-dag': `f"{n} {len(dependencies)}\\n" + (M(dependencies) + "\\n" if dependencies else "")`,
  'range-update-queries': `f"{len(a)} {len(ops)}\\n{J(a)}\\n{M(ops)}\\n"`,
  'median-two-sorted': `f"{len(a)} {len(b)}\\n{J(a)}\\n{J(b)}\\n"`,
  'lis-count': `f"{len(a)}\\n{J(a)}\\n"`,
  'tsp-small': `f"{len(d)}\\n{M(d)}\\n"`,
  'weighted-intervals': `f"{len(requests)}\\n{M(requests)}\\n"`,
};

/** How to turn what the reference printed back into solve's return value. */
const RETURN: Record<string, string> = {
  int: 'int(_out.strip())',
  bool: "_out.strip() == 'YES'",
  str: '_out.strip()',
  ints: '[int(x) for x in _out.split()]',
  intLines: '[int(x) for x in _out.split()]',
  half: 'float(_out.strip())',
};

function pythonAdapter(p: ProblemDef): string {
  const sig = SIGNATURES[p.slug]!;
  // base64 keeps the reference's own stdin handling out of the source, so the judge still sees a bare solve().
  const ref = Buffer.from(p.python).toString('base64');
  return `import base64, contextlib, io, sys

J = lambda a: ' '.join(map(str, a))
M = lambda m: '\\n'.join(J(r) for r in m)
_REF = compile(base64.b64decode('${ref}').decode(), 'reference', 'exec')


def solve(${sig.params.map((x) => x.name).join(', ')}):
    _text = ${REBUILD[p.slug]}
    setattr(sys, 'stdin', io.TextIOWrapper(io.BytesIO(_text.encode())))
    _buf = io.StringIO()
    with contextlib.redirect_stdout(_buf):
        exec(_REF, {'__name__': '__main__'})
    _out = _buf.getvalue()
    return ${RETURN[sig.ret]}
`;
}

describe('second batch: the Python driver parses and prints every shape', () => {
  it('has a rebuild rule for every problem', () => {
    expect(Object.keys(REBUILD).sort()).toEqual(extraProblems.map((p) => p.slug).sort());
  });

  describe.concurrent('solve() reproduces the reference answers', () => {
    for (const p of extraProblems)
      it(p.slug, async () => {
        const code = pythonAdapter(p);
        // a bare function, so the judge wraps it with the driver rather than running it as a program
        expect(withDriver(p.slug, 'python', code)).toContain('_grader_main()');
        // The adapter parses the input twice (the driver, then the reference), so it gets extra time:
        // this checks that the parsed arguments and printed answer are right, not how fast Python is.
        expect(failures(await judge(p, 'python', code, 3))).toEqual([]);
      });
  });
});

const CPP_HEADER = '#include <bits/stdc++.h>\nusing namespace std;\n\n';

const CPP: Record<string, string> = {
  'longest-common-prefix': `string solve(vector<string> words) {
  string p = words[0];
  for (auto& w : words) { size_t i = 0; while (i < p.size() && i < w.size() && p[i] == w[i]) ++i; p.resize(i); }
  return p.empty() ? "NONE" : p;
}\n`,
  'word-break-count': `long long solve(vector<string> words, string s) {
  const long long MOD = 1000000007;
  int n = s.size();
  vector<long long> dp(n + 1, 0);
  dp[n] = 1;
  for (int i = n - 1; i >= 0; --i) {
    long long t = 0;
    for (auto& w : words) if (i + (int)w.size() <= n && s.compare(i, w.size(), w) == 0) t += dp[i + w.size()];
    dp[i] = t % MOD;
  }
  return dp[0];
}\n`,
  'median-two-sorted': `double solve(vector<long long> a, vector<long long> b) {
  vector<long long> m(a);
  m.insert(m.end(), b.begin(), b.end());
  sort(m.begin(), m.end());
  size_t t = m.size();
  return t % 2 ? (double)m[t / 2] : (m[t / 2 - 1] + m[t / 2]) / 2.0;
}\n`,
  'lca-queries': `vector<long long> solve(long long n, vector<vector<long long>> links, vector<vector<long long>> queries) {
  vector<vector<int>> adj(n + 1);
  for (auto& e : links) { adj[e[0]].push_back(e[1]); adj[e[1]].push_back(e[0]); }
  const int LOG = 17;
  vector<vector<int>> up(LOG, vector<int>(n + 1, 0));
  vector<int> dep(n + 1, 0), order = {1};
  for (size_t h = 0; h < order.size(); ++h) {
    int u = order[h];
    for (int v : adj[u]) if (v != up[0][u]) { up[0][v] = u; dep[v] = dep[u] + 1; order.push_back(v); }
  }
  for (int j = 1; j < LOG; ++j) for (int v = 1; v <= n; ++v) up[j][v] = up[j - 1][up[j - 1][v]];
  vector<long long> out;
  for (auto& q : queries) {
    int u = q[0], v = q[1];
    if (dep[u] < dep[v]) swap(u, v);
    int d = dep[u] - dep[v];
    for (int j = 0; d; ++j, d >>= 1) if (d & 1) u = up[j][u];
    if (u != v) {
      for (int j = LOG - 1; j >= 0; --j) if (up[j][u] != up[j][v]) { u = up[j][u]; v = up[j][v]; }
      u = up[0][u];
    }
    out.push_back(u);
  }
  return out;
}\n`,
  'range-update-queries': `vector<long long> solve(vector<long long> a, vector<vector<long long>> ops) {
  int n = a.size();
  vector<long long> bit(n + 1, 0);
  auto add = [&](int i, long long v) { for (; i <= n; i += i & -i) bit[i] += v; };
  auto pre = [&](int i) { long long s = 0; for (; i > 0; i -= i & -i) s += bit[i]; return s; };
  for (int i = 0; i < n; ++i) add(i + 1, a[i]);
  vector<long long> out;
  for (auto& o : ops) { if (o[0] == 1) add(o[1], o[2]); else out.push_back(pre(o[2]) - pre(o[1] - 1)); }
  return out;
}\n`,
  'tree-diameter': `long long solve(long long n, vector<vector<long long>> cables) {
  vector<vector<int>> adj(n + 1);
  for (auto& e : cables) { adj[e[0]].push_back(e[1]); adj[e[1]].push_back(e[0]); }
  auto bfs = [&](int src) {
    vector<int> d(n + 1, -1);
    d[src] = 0;
    vector<int> q = {src};
    int last = src;
    for (size_t h = 0; h < q.size(); ++h) {
      int u = q[h]; last = u;
      for (int v : adj[u]) if (d[v] < 0) { d[v] = d[u] + 1; q.push_back(v); }
    }
    return make_pair(last, d[last]);
  };
  return bfs(bfs(1).first).second;
}\n`,
  'lis-count': `vector<long long> solve(vector<long long> a) {
  const long long MOD = 1000000007;
  int n = a.size();
  vector<int> len(n, 1);
  vector<long long> cnt(n, 1);
  for (int i = 0; i < n; ++i) for (int j = 0; j < i; ++j) if (a[j] < a[i]) {
    if (len[j] + 1 > len[i]) { len[i] = len[j] + 1; cnt[i] = cnt[j]; }
    else if (len[j] + 1 == len[i]) cnt[i] = (cnt[i] + cnt[j]) % MOD;
  }
  int best = *max_element(len.begin(), len.end());
  long long total = 0;
  for (int i = 0; i < n; ++i) if (len[i] == best) total = (total + cnt[i]) % MOD;
  return {best, total};
}\n`,
  'bipartite-check': `bool solve(long long n, vector<vector<long long>> rivalries) {
  vector<vector<int>> adj(n + 1);
  for (auto& e : rivalries) { adj[e[0]].push_back(e[1]); adj[e[1]].push_back(e[0]); }
  vector<int> c(n + 1, -1);
  for (int s = 1; s <= n; ++s) {
    if (c[s] != -1) continue;
    c[s] = 0;
    vector<int> q = {s};
    for (size_t h = 0; h < q.size(); ++h) {
      int u = q[h];
      for (int v : adj[u]) { if (c[v] == -1) { c[v] = 1 - c[u]; q.push_back(v); } else if (c[v] == c[u]) return false; }
    }
  }
  return true;
}\n`,
};

describe('second batch: the C++ driver parses and prints the tricky shapes', () => {
  for (const [slug, code] of Object.entries(CPP))
    it(`${slug} (cpp)`, async () => {
      const p = extraProblems.find((x) => x.slug === slug)!;
      expect(failures(await judge(p, 'cpp', CPP_HEADER + code))).toEqual([]);
    });
});
