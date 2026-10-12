import { describe, expect, it } from 'vitest';
import { DockerExecutor } from '../src/judge/docker-executor.js';
import { normaliseOutput, type ExecTest } from '../src/judge/executor.js';

const exec = new DockerExecutor({ image: 'thegrave-judge:latest' });
const limits = { timeLimitMs: 1000, memoryLimitMb: 256 };
const addTests: ExecTest[] = [
  { input: '1 2\n', expected: '3\n' },
  { input: '-5 5\n', expected: '0' },
  { input: '2000000000 2000000000\n', expected: '4000000000\n' },
];
const py = (code: string, tests = addTests) => exec.run('python', code, tests, limits);
const cpp = (code: string, tests = addTests) => exec.run('cpp', code, tests, limits);
const one: ExecTest[] = [{ input: '', expected: 'ok\n' }];

describe('normaliseOutput', () => {
  it('ignores trailing whitespace per line, CRLF and trailing blank lines only', () => {
    expect(normaliseOutput('1 2  \r\n3\n\n\n')).toBe('1 2\n3');
    expect(normaliseOutput(' 1')).not.toBe(normaliseOutput('1'));
    expect(normaliseOutput('1\n\n2')).not.toBe(normaliseOutput('1\n2'));
  });
});

describe('verdicts', () => {
  it('ACCEPTED (python + cpp)', async () => {
    const p = await py('a, b = map(int, input().split())\nprint(a + b)\n');
    expect(p).toMatchObject({ verdict: 'ACCEPTED', passed: 3, total: 3 });
    const c = await cpp(
      '#include <bits/stdc++.h>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}',
    );
    expect(c).toMatchObject({ verdict: 'ACCEPTED', passed: 3, total: 3 });
  });

  it('WRONG_ANSWER with partial credit, reporting the first failing test', async () => {
    // int overflow on the third test only
    const r = await cpp('#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}');
    expect(r.verdict).toBe('WRONG_ANSWER');
    expect(r.tests.map((t) => t.verdict)).toEqual(['ACCEPTED', 'ACCEPTED', 'WRONG_ANSWER']);
    expect(r.passed).toBe(2);
  });

  it('COMPILE_ERROR with compiler output', async () => {
    const r = await cpp('int main() { return x; }');
    expect(r.verdict).toBe('COMPILE_ERROR');
    expect(r.passed).toBe(0);
    expect(r.compileOutput).toMatch(/'x' was not declared/);
  });

  it('RUNTIME_ERROR for exceptions, non-zero exit and segfaults', async () => {
    expect((await py('raise ValueError("boom")', one)).verdict).toBe('RUNTIME_ERROR');
    expect((await py('import sys; print("ok"); sys.exit(3)', one)).verdict).toBe('RUNTIME_ERROR');
    const seg = await cpp('int main(){ volatile int* p = nullptr; *p = 1; }', one);
    expect(seg.verdict).toBe('RUNTIME_ERROR');
    const r = await py('raise ValueError("boom")', one);
    expect(r.tests[0]!.stderr).toMatch(/ValueError: boom/);
  });
});

describe('abuse is contained and reported correctly', () => {
  it('infinite loop → TLE (python + cpp), killed at the limit', async () => {
    const p = await py('while True: pass', one);
    expect(p.verdict).toBe('TLE');
    expect(p.tests[0]!.timeMs).toBeLessThan(1500);
    expect((await cpp('int main(){ for(;;); }', one)).verdict).toBe('TLE');
  });

  it('sleeping (no CPU) is still TLE: the limit is wall clock', async () => {
    expect((await py('import time; time.sleep(30)', one)).verdict).toBe('TLE');
  });

  it('memory hog → MLE (python + cpp)', async () => {
    expect((await py('a = [1] * (10**9)', one)).verdict).toBe('MLE');
    expect((await py('a = bytearray(b"x") * (600 * 2**20)', one)).verdict).toBe('MLE');
    const c = await cpp(
      '#include <vector>\n#include <cstdio>\nint main(){ std::vector<long long> v(200000000, 1); std::printf("%lld", v[12345]); }',
      one,
    );
    expect(c.verdict).toBe('MLE');
  });

  it('fork bomb → contained by pids limit, reported as TLE, and later tests still run', async () => {
    const bomb = [
      'import os',
      'while True:',
      '    try:',
      '        os.fork()',
      '    except OSError:',
      '        pass',
    ].join('\n');
    const r = await py(bomb, [...one, ...one]);
    expect(r.tests.map((t) => t.verdict)).toEqual(['TLE', 'TLE']);
    // The judge itself survived: a following, normal container still works.
    expect((await py('print("ok")', one)).verdict).toBe('ACCEPTED');
  });

  it('forks that detach (setsid) are killed between tests and cannot touch the next test', async () => {
    const code = [
      'import os, sys',
      'data = sys.stdin.read().strip()',
      'if data == "1":',
      '    if os.fork() == 0:',
      '        os.setsid()',
      '        while True: open("/tmp/work/out", "a").write("POISON\\n")',
      'print("ok")',
    ].join('\n');
    const r = await py(code, [
      { input: '1', expected: 'ok' },
      { input: '2', expected: 'ok' },
    ]);
    expect(r.tests[1]!.verdict).toBe('ACCEPTED');
  });

  it('no network access', async () => {
    const code = [
      'import socket',
      'try:',
      '    socket.create_connection(("1.1.1.1", 80), timeout=2)',
      '    print("connected")',
      'except OSError:',
      '    print("ok")',
    ].join('\n');
    expect((await py(code, one)).verdict).toBe('ACCEPTED');
    // musl's resolver retries until the time limit, so this is TLE: what matters is it never resolves.
    const dns =
      'import socket\ntry:\n    socket.gethostbyname("example.com"); print("resolved")\nexcept OSError:\n    print("ok")';
    const r = await py(dns, one);
    expect(r.tests[0]!.stdout).not.toContain('resolved');
    expect(['ACCEPTED', 'TLE']).toContain(r.verdict);
  });

  it('filesystem is read-only outside a size-capped /tmp, and the runner cannot be replaced', async () => {
    const code = [
      'wrote = []',
      'for path in ["/x", "/etc/passwd", "/judge/runner.py", "/usr/bin/python3"]:',
      '    try:',
      '        open(path, "w").write("pwned")',
      '        wrote.append(path)',
      '    except OSError:',
      '        pass',
      'print("ok" if not wrote else wrote)',
    ].join('\n');
    expect((await py(code, one)).verdict).toBe('ACCEPTED');
    // Filling /tmp hits the output-file size limit instead of exhausting host disk.
    const fill =
      'f = open("/tmp/big", "wb")\nfor _ in range(200): f.write(b"x" * 2**20)\nprint("ok")';
    expect((await py(fill, one)).verdict).toBe('RUNTIME_ERROR');
  });

  it('runs as an unprivileged user with no capabilities', async () => {
    const code = [
      'import os',
      'caps = [l for l in open("/proc/self/status") if l.startswith("CapEff")][0].split()[1]',
      'print("ok" if os.getuid() == 65534 and int(caps, 16) == 0 else (os.getuid(), caps))',
    ].join('\n');
    expect((await py(code, one)).verdict).toBe('ACCEPTED');
  });

  it('cannot kill the runner (PID 1)', async () => {
    const code =
      'import os, signal\ntry:\n    os.kill(1, signal.SIGKILL)\nexcept OSError:\n    pass\nprint("ok")';
    const r = await py(code, [...one, ...one]);
    expect(r).toMatchObject({ verdict: 'ACCEPTED', passed: 2 });
  });

  it('output flood → RUNTIME_ERROR (output limit), not a hung judge', async () => {
    const r = await py('while True: print("x" * 1000)', one);
    expect(r.verdict).toBe('RUNTIME_ERROR');
    expect(r.tests[0]!.stderr).toMatch(/Output limit/);
  });

  it('cannot read expected outputs (they are never sent into the container)', async () => {
    const code = 'import json, sys\nprint("ok")\nsys.stderr.write(open("/proc/1/cmdline").read())';
    const r = await py(code, [{ input: '', expected: 'ok\nSECRET-EXPECTED' }]);
    expect(r.tests[0]!.stderr).not.toContain('SECRET-EXPECTED');
  });
});
