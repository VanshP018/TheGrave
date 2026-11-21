import { describe, expect, it } from 'vitest';
import { InterviewError } from '../src/interviews/errors.js';
import { profileRepo, treeScore } from '../src/interviews/profile.js';
import { MemoryRepoSource } from '../src/interviews/source.js';
import {
  AWS_EXAMPLE_KEY,
  docsOnly,
  empty,
  expressApi,
  pythonCli,
} from './fixtures/interview-repos.js';

const signal = new AbortController().signal;
const ref = { owner: 'acme', repo: 'orders', ref: null };

async function profile(files: Record<string, string | Buffer>) {
  const source = new MemoryRepoSource(files, { description: 'demo' });
  return profileRepo(source, await source.resolve(ref), signal);
}

describe('profileRepo', () => {
  it('profiles the express fixture', async () => {
    const p = await profile(expressApi);
    const paths = p.files.map((f) => f.path);

    // Skipped by name or content: lockfile, .env, minified, binary, bundled one-liner, 70 KB file
    for (const absent of [
      'package-lock.json',
      '.env',
      'dist/app.min.js',
      'logo.png',
      'src/legacy/bundle.js',
      'src/data/seed.js',
    ])
      expect(paths).not.toContain(absent);

    expect(paths).toContain('src/server.js');
    expect(paths).toContain('src/queue/worker.js');
    expect(paths).toContain('package.json');
    expect(paths.indexOf('src/server.js')).toBeLessThan(
      paths.indexOf('examples/basic/deep/er/still/deeper/demo.js'),
    );

    expect(p.languages[0]).toMatchObject({ name: 'JavaScript' });
    expect(p.manifests).toEqual(['.github/workflows/ci.yml', 'package.json']);
    expect(p.hasCi).toBe(true);
    expect(p.hasTests).toBe(true);
    expect(p.testRatio).toBeGreaterThan(0);
    expect(p.hasReadme).toBe(true);
    expect(p.readme).toContain('Orders API');
    expect(p.description).toBe('demo');
    expect(p.truncatedTree).toBe(false);
  });

  it('computes content signals', async () => {
    const p = await profile(expressApi);
    const byPath = new Map(p.files.map((f) => [f.path, f]));
    // worker.js is imported by server.js and routes/orders.js; the model by two files too
    expect(byPath.get('src/queue/worker.js')!.fanIn).toBe(2);
    expect(byPath.get('src/models/order.js')!.fanIn).toBeGreaterThanOrEqual(2);
    expect(byPath.get('src/server.js')!.todos).toBe(1);
    expect(byPath.get('src/server.js')!.complexity).toBeGreaterThan(0);
    for (const f of p.files) expect(f.finalScore).toBeGreaterThanOrEqual(f.treeScore);
    // sorted best first
    const scores = p.files.map((f) => f.finalScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('redacts secrets in fetched files and counts them', async () => {
    const p = await profile({
      ...expressApi,
      'src/aws.js': `export const key = "${AWS_EXAMPLE_KEY}";\n`,
    });
    const aws = p.files.find((f) => f.path === 'src/aws.js')!;
    expect(aws.text).not.toContain(AWS_EXAMPLE_KEY);
    expect(p.redactions).toBeGreaterThanOrEqual(1);
    expect(p.files.every((f) => !f.text.includes(AWS_EXAMPLE_KEY))).toBe(true);
  });

  it('is deterministic', async () => {
    expect(await profile(expressApi)).toEqual(await profile(expressApi));
  });

  it('profiles the python fixture', async () => {
    const p = await profile(pythonCli);
    expect(p.languages[0]).toMatchObject({ name: 'Python', share: 1 });
    expect(p.files[0]!.path).toMatch(/^todo\//);
    expect(p.hasTests).toBe(true);
    expect(p.apparentLevel).toBe('JUNIOR');
  });

  it('heuristic level is MID with tests, CI, several authors and many commits', async () => {
    const source = new MemoryRepoSource(expressApi, { history: { authors: 3, totalCommits: 100 } });
    const p = await profileRepo(source, await source.resolve(ref), signal);
    expect(p.apparentLevel).toBe('MID');
  });

  it('docs-only repos have no source files', async () => {
    await expect(profile(docsOnly)).rejects.toMatchObject({ code: 'NO_SOURCE_FILES' });
  });

  it('empty repos are REPO_EMPTY at resolve', async () => {
    const source = new MemoryRepoSource(empty);
    await expect(source.resolve(ref)).rejects.toBeInstanceOf(InterviewError);
    await expect(source.resolve(ref)).rejects.toMatchObject({ code: 'REPO_EMPTY' });
  });

  it('a repo whose only source is unreadable is NO_SOURCE_FILES', async () => {
    await expect(profile({ 'a.js': 'x=1;'.repeat(200) })).rejects.toMatchObject({
      code: 'NO_SOURCE_FILES',
    });
  });
});

describe('treeScore', () => {
  it('rewards entry points and core dirs, penalises depth and examples', () => {
    expect(treeScore('src/server.js', 2500)).toBe(55);
    expect(treeScore('examples/a/b/c/d/e/demo.js', 2500)).toBeLessThan(
      treeScore('src/utils/format.js', 2500),
    );
    expect(treeScore('src/routes/orders.js', 100)).toBe(35);
    expect(treeScore('a.js', 100)).toBe(0);
  });
});
