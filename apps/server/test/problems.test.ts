import { describe, expect, it } from 'vitest';
import { DockerExecutor } from '../src/judge/docker-executor.js';
import { effectiveTimeLimitMs } from '../src/judge/executor.js';
import { buildTestCases } from '../src/seed/build.js';
import { problems } from '../src/seed/problems.js';
import { TAGS } from '../src/seed/tags.js';

const exec = new DockerExecutor({ image: 'thegrave-judge:latest' });

describe('problem set', () => {
  it('has 30 problems with unique slugs across all difficulties', () => {
    expect(problems).toHaveLength(30);
    expect(new Set(problems.map((p) => p.slug)).size).toBe(30);
    for (const d of ['EASY', 'MEDIUM', 'HARD']) {
      expect(problems.filter((p) => p.difficulty === d).length).toBeGreaterThanOrEqual(8);
    }
  });

  it('tags every problem with one to three topics, and nothing else', () => {
    for (const p of problems) expect(TAGS[p.slug]?.length, p.slug).toBeGreaterThanOrEqual(1);
    for (const tags of Object.values(TAGS)) expect(tags.length).toBeLessThanOrEqual(3);
    expect(Object.keys(TAGS).sort()).toEqual(problems.map((p) => p.slug).sort());
  });

  it('generates deterministic tests with samples first', () => {
    for (const p of problems) {
      const a = buildTestCases(p);
      expect(a.map((t) => t.expected)).toEqual(buildTestCases(p).map((t) => t.expected));
      expect(a.filter((t) => t.isSample).length).toBe(p.samples.length);
      expect(a.filter((t) => !t.isSample).length).toBeGreaterThanOrEqual(4);
      expect(a.every((t) => t.input.endsWith('\n'))).toBe(true);
    }
  });

  // Two independent solutions (TS generates expected output, Python is judged) must agree on every test,
  // and the Python one must fit the Python time limit: this validates both the data and the limits.
  describe.concurrent('independent Python reference is ACCEPTED', () => {
    for (const p of problems) {
      it(p.slug, async () => {
        const tests = buildTestCases(p);
        const res = await exec.run('python', p.python, tests, {
          timeLimitMs: effectiveTimeLimitMs(p.timeLimitMs ?? 1000, 'python'),
          memoryLimitMb: 256,
        });
        const failed = res.tests
          .filter((t) => t.verdict !== 'ACCEPTED')
          .map((t) => `#${t.index} ${t.verdict} ${t.timeMs}ms ${t.stderr.slice(-300)}`);
        expect(failed, `${p.slug} failures`).toEqual([]);
      });
    }
  });
});
