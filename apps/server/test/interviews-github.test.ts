import { describe, expect, it } from 'vitest';
import { GitHubRepoSource } from '../src/interviews/github.js';
import type { RepoMeta } from '../src/interviews/source.js';

const signal = new AbortController().signal;
const ref = { owner: 'acme', repo: 'orders', ref: null };
const SHA = 'b'.repeat(40);

const repoJson = {
  name: 'orders',
  full_name: 'acme/orders',
  owner: { login: 'acme' },
  description: 'demo',
  private: false,
  visibility: 'public',
  default_branch: 'main',
  size: 120,
  fork: false,
  archived: false,
  pushed_at: '2024-06-01T00:00:00Z',
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function stub(handler: Handler) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, headers: init.headers as Record<string, string> });
    expect(init.redirect).toBe('manual');
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

const meta: RepoMeta = {
  owner: 'acme',
  repo: 'orders',
  displayName: 'acme/orders',
  description: null,
  defaultBranch: 'main',
  sha: SHA,
  sizeKb: 1,
  fork: false,
  archived: false,
  pushedAt: '',
};

describe('GitHubRepoSource', () => {
  it('resolves metadata with the right URLs and headers', async () => {
    const { fn, calls } = stub((url) =>
      url.endsWith('/repos/acme/orders') ? json(repoJson) : json({ sha: SHA }),
    );
    const m = await new GitHubRepoSource({ fetch: fn }).resolve(ref, signal);
    expect(m).toMatchObject({
      displayName: 'acme/orders',
      sha: SHA,
      defaultBranch: 'main',
      sizeKb: 120,
    });
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.github.com/repos/acme/orders',
      'https://api.github.com/repos/acme/orders/commits/main',
    ]);
    expect(calls[0]!.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'thegrave-interviews',
    });
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  it('uses the requested ref, URL-encoded per segment', async () => {
    const { fn, calls } = stub((url) =>
      url.endsWith('/repos/acme/orders') ? json(repoJson) : json({ sha: SHA }),
    );
    await new GitHubRepoSource({ fetch: fn }).resolve({ ...ref, ref: 'feat/x y' }, signal);
    expect(calls[1]!.url).toBe('https://api.github.com/repos/acme/orders/commits/feat/x%20y');
  });

  it('builds tree and history requests', async () => {
    const { fn, calls } = stub((url) =>
      url.includes('/git/trees/')
        ? json({
            truncated: true,
            tree: [
              { path: 'a.js', mode: '100644', type: 'blob', size: 10 },
              { path: 'src', mode: '040000', type: 'tree' },
              { path: 'weird', mode: '1', type: 'other' },
            ],
          })
        : json([
            {
              author: { login: 'A' },
              commit: { message: 'Add queue', author: { date: '2024-02-01T00:00:00Z' } },
            },
            {
              author: { login: 'b' },
              commit: { message: 'wip', author: { date: '2024-01-01T00:00:00Z' } },
            },
          ]),
    );
    const src = new GitHubRepoSource({ fetch: fn });
    const tree = await src.tree(meta, signal);
    expect(tree.truncated).toBe(true);
    expect(tree.entries).toEqual([
      { path: 'a.js', mode: '100644', type: 'blob', size: 10 },
      { path: 'src', mode: '040000', type: 'tree' },
    ]);
    const h = await src.history(meta, signal);
    expect(h).toEqual({
      totalCommits: 2,
      authors: 2,
      firstCommitAt: '2024-01-01T00:00:00Z',
      lastCommitAt: '2024-02-01T00:00:00Z',
      lowQualityMessageShare: 0.5,
    });
    expect(calls.map((c) => c.url)).toEqual([
      `https://api.github.com/repos/acme/orders/git/trees/${SHA}?recursive=1`,
      `https://api.github.com/repos/acme/orders/commits?sha=${SHA}&per_page=100`,
    ]);
  });

  it('rejects private repositories, even when the token could see them', async () => {
    for (const body of [
      { ...repoJson, private: true },
      { ...repoJson, visibility: 'internal' },
      { ...repoJson, visibility: undefined },
    ]) {
      const { fn } = stub(() => json(body));
      await expect(
        new GitHubRepoSource({ fetch: fn, token: 't' }).resolve(ref, signal),
      ).rejects.toMatchObject({
        code: 'REPO_NOT_PUBLIC',
      });
    }
  });

  it('rejects repositories over the size limit', async () => {
    const { fn } = stub(() => json({ ...repoJson, size: 2 * 1024 }));
    await expect(
      new GitHubRepoSource({ fetch: fn, maxRepoMb: 1 }).resolve(ref, signal),
    ).rejects.toMatchObject({ code: 'REPO_TOO_LARGE' });
  });

  it('maps 404, 409, 422, rate limits and server errors', async () => {
    const run = (handler: Handler) =>
      new GitHubRepoSource({ fetch: stub(handler).fn }).resolve(ref, signal);
    const notRepo = (url: string) => url.endsWith('/repos/acme/orders');

    await expect(run(() => new Response('', { status: 404 }))).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND',
    });
    await expect(
      run((u) => (notRepo(u) ? json(repoJson) : new Response('', { status: 409 }))),
    ).rejects.toMatchObject({ code: 'REPO_EMPTY' });
    await expect(
      run((u) => (notRepo(u) ? json(repoJson) : new Response('', { status: 422 }))),
    ).rejects.toMatchObject({ code: 'REPO_NOT_FOUND' });
    await expect(
      run(() => new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })),
    ).rejects.toMatchObject({ code: 'GITHUB_RATE_LIMITED' });
    await expect(run(() => new Response('', { status: 429 }))).rejects.toMatchObject({
      code: 'GITHUB_RATE_LIMITED',
    });
    await expect(run(() => new Response('', { status: 503 }))).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
    });
    await expect(
      run(() => {
        throw new TypeError('network down');
      }),
    ).rejects.toMatchObject({ code: 'GITHUB_UNAVAILABLE' });
  });

  it('refuses redirects to other hosts and follows api.github.com ones', async () => {
    const evil = stub(
      () => new Response(null, { status: 301, headers: { location: 'https://evil.com/x' } }),
    );
    await expect(
      new GitHubRepoSource({ fetch: evil.fn }).resolve(ref, signal),
    ).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
    });
    expect(evil.calls).toHaveLength(1);

    const plain = stub(
      () => new Response(null, { status: 301, headers: { location: 'http://api.github.com/x' } }),
    );
    await expect(
      new GitHubRepoSource({ fetch: plain.fn }).resolve(ref, signal),
    ).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
    });

    const renamed = stub((url) => {
      if (url === 'https://api.github.com/repos/acme/orders')
        return new Response(null, {
          status: 301,
          headers: { location: 'https://api.github.com/repositories/42' },
        });
      if (url === 'https://api.github.com/repositories/42') return json(repoJson);
      return json({ sha: SHA });
    });
    const m = await new GitHubRepoSource({ fetch: renamed.fn }).resolve(ref, signal);
    expect(m.sha).toBe(SHA);
    expect(renamed.calls[1]!.url).toBe('https://api.github.com/repositories/42');

    const loop = stub(
      () =>
        new Response(null, { status: 301, headers: { location: 'https://api.github.com/loop' } }),
    );
    await expect(
      new GitHubRepoSource({ fetch: loop.fn }).resolve(ref, signal),
    ).rejects.toMatchObject({
      code: 'GITHUB_UNAVAILABLE',
    });
    expect(loop.calls).toHaveLength(3); // the original request plus two hops
  });

  it('reads files from raw.githubusercontent.com at the pinned SHA', async () => {
    const { fn, calls } = stub((url) =>
      url.endsWith('missing.js')
        ? new Response('', { status: 404 })
        : new Response('const a = 1;\n'),
    );
    const src = new GitHubRepoSource({ fetch: fn });
    const buf = await src.readFile(meta, 'src/my file.js', 1000, signal);
    expect(buf?.toString()).toBe('const a = 1;\n');
    expect(calls[0]!.url).toBe(
      `https://raw.githubusercontent.com/acme/orders/${SHA}/src/my%20file.js`,
    );
    expect(await src.readFile(meta, 'missing.js', 1000, signal)).toBeNull();
  });

  it('returns null for bodies over the cap (header or streamed)', async () => {
    const big = 'x'.repeat(5000);
    const withHeader = stub(() => new Response(big, { headers: { 'content-length': '5000' } }));
    expect(
      await new GitHubRepoSource({ fetch: withHeader.fn }).readFile(meta, 'a.js', 1000, signal),
    ).toBeNull();

    const streamed = stub(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(600));
              c.enqueue(new Uint8Array(600));
              c.close();
            },
          }),
        ),
    );
    expect(
      await new GitHubRepoSource({ fetch: streamed.fn }).readFile(meta, 'a.js', 1000, signal),
    ).toBeNull();
    expect(
      (await new GitHubRepoSource({ fetch: streamed.fn }).readFile(meta, 'a.js', 1200, signal))
        ?.length,
    ).toBe(1200);
  });

  it('sends GITHUB_TOKEN as a bearer token to the API only', async () => {
    const { fn, calls } = stub((url) =>
      url.startsWith('https://raw.')
        ? new Response('x')
        : url.endsWith('/orders')
          ? json(repoJson)
          : json({ sha: SHA }),
    );
    const src = new GitHubRepoSource({ fetch: fn, token: 'tok123' });
    await src.resolve(ref, signal);
    await src.readFile(meta, 'a.js', 100, signal);
    expect(calls[0]!.headers.Authorization).toBe('Bearer tok123');
    expect(calls[1]!.headers.Authorization).toBe('Bearer tok123');
    expect(calls[2]!.headers.Authorization).toBeUndefined();
  });
});
