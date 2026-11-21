import type { RepoRef } from '@thegrave/shared';
import { InterviewError } from './errors.js';
import { MAX_TREE_ENTRIES } from './profile.js';
import type { HistorySignals, RepoMeta, RepoSource, TreeEntry } from './source.js';

const API_HOST = 'api.github.com';
const RAW_HOST = 'raw.githubusercontent.com';
const ALLOWED_HOSTS = new Set([API_HOST, RAW_HOST]);
const MAX_REDIRECTS = 2;
const REQUEST_TIMEOUT_MS = 10_000;
/** Largest JSON body we will parse from GitHub (a 20k-entry tree is a few MB). */
const MAX_JSON_BYTES = 8 * 1024 * 1024;

export interface GitHubOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Fine-grained token with no repository permissions; optional (raises the rate limit). */
  token?: string;
  maxRepoMb?: number;
  timeoutMs?: number;
}

const LOW_QUALITY_MESSAGE =
  /^(?:\.+|-+|fix(?:es|ed)?|update[sd]?|wip|test(?:s|ing)?|asdf+|commit|changes?|misc|stuff|temp|tmp|initial commit|first commit|minor|edit|save|done|\w{1,3})$/i;

interface JsonObject {
  [key: string]: unknown;
}
const obj = (v: unknown): JsonObject => (v && typeof v === 'object' ? (v as JsonObject) : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Public GitHub repositories over REST + raw.githubusercontent.com. Only those two hosts are ever contacted. */
export class GitHubRepoSource implements RepoSource {
  private readonly doFetch: typeof fetch;
  constructor(private readonly opts: GitHubOptions = {}) {
    this.doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** One GET with manual, host-restricted redirects, a timeout, and GitHub status mapping. */
  private async get(url: string, signal: AbortSignal, accept: string): Promise<Response> {
    const combined = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
    ]);
    let current = url;
    for (let hop = 0; ; hop++) {
      const host = new URL(current).hostname;
      const headers: Record<string, string> = {
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'thegrave-interviews',
      };
      if (this.opts.token && host === API_HOST) headers.Authorization = `Bearer ${this.opts.token}`;
      let res: Response;
      try {
        res = await this.doFetch(current, { headers, redirect: 'manual', signal: combined });
      } catch {
        if (signal.aborted) throw new InterviewError('TIMEOUT');
        throw new InterviewError('GITHUB_UNAVAILABLE');
      }
      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const loc = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!loc || hop >= MAX_REDIRECTS) throw new InterviewError('GITHUB_UNAVAILABLE');
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          throw new InterviewError('GITHUB_UNAVAILABLE');
        }
        if (next.protocol !== 'https:' || next.port || !ALLOWED_HOSTS.has(next.hostname))
          throw new InterviewError('GITHUB_UNAVAILABLE');
        current = next.toString();
        continue;
      }
      return res;
    }
  }

  /** Statuses every call treats the same way; returns normally for 2xx and anything else the caller handles. */
  private async guard(res: Response, handled: number[] = []): Promise<void> {
    if (res.ok || handled.includes(res.status)) return;
    await res.body?.cancel().catch(() => undefined);
    const exhausted = res.headers.get('x-ratelimit-remaining') === '0';
    if (res.status === 429 || (res.status === 403 && exhausted))
      throw new InterviewError('GITHUB_RATE_LIMITED');
    if (res.status === 404) throw new InterviewError('REPO_NOT_FOUND');
    throw new InterviewError('GITHUB_UNAVAILABLE');
  }

  private async json(res: Response): Promise<unknown> {
    try {
      const text = await readCapped(res, MAX_JSON_BYTES);
      if (text === null) throw new Error('too large');
      return JSON.parse(text.toString('utf8'));
    } catch {
      throw new InterviewError('GITHUB_UNAVAILABLE');
    }
  }

  async resolve(ref: RepoRef, signal: AbortSignal): Promise<RepoMeta> {
    const base = `https://${API_HOST}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
    const repoRes = await this.get(base, signal, 'application/vnd.github+json');
    await this.guard(repoRes);
    const r = obj(await this.json(repoRes));
    if (r.private !== false || r.visibility !== 'public')
      throw new InterviewError('REPO_NOT_PUBLIC');
    const sizeKb = typeof r.size === 'number' ? r.size : 0;
    const maxMb = this.opts.maxRepoMb ?? 500;
    if (sizeKb > maxMb * 1024) throw new InterviewError('REPO_TOO_LARGE');
    const defaultBranch = str(r.default_branch) ?? 'main';

    const target = ref.ref ?? defaultBranch;
    const commitRes = await this.get(
      `${base}/commits/${encodePath(target)}`,
      signal,
      'application/vnd.github+json',
    );
    if (commitRes.status === 409) {
      await commitRes.body?.cancel().catch(() => undefined);
      throw new InterviewError('REPO_EMPTY');
    }
    if (commitRes.status === 422) {
      await commitRes.body?.cancel().catch(() => undefined);
      throw new InterviewError('REPO_NOT_FOUND');
    }
    await this.guard(commitRes);
    const sha = str(obj(await this.json(commitRes)).sha);
    if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) throw new InterviewError('GITHUB_UNAVAILABLE');

    return {
      owner: str(obj(r.owner).login) ?? ref.owner,
      repo: str(r.name) ?? ref.repo,
      displayName: str(r.full_name) ?? `${ref.owner}/${ref.repo}`,
      description: str(r.description),
      defaultBranch,
      sha: sha.toLowerCase(),
      sizeKb,
      fork: r.fork === true,
      archived: r.archived === true,
      pushedAt: str(r.pushed_at) ?? '',
    };
  }

  async tree(
    meta: RepoMeta,
    signal: AbortSignal,
  ): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const url = `https://${API_HOST}/repos/${encodeURIComponent(meta.owner)}/${encodeURIComponent(meta.repo)}/git/trees/${meta.sha}?recursive=1`;
    const res = await this.get(url, signal, 'application/vnd.github+json');
    await this.guard(res);
    const body = obj(await this.json(res));
    const raw = Array.isArray(body.tree) ? body.tree : [];
    const entries: TreeEntry[] = [];
    for (const item of raw.slice(0, MAX_TREE_ENTRIES)) {
      const e = obj(item);
      const path = str(e.path);
      const type = e.type;
      if (!path || (type !== 'blob' && type !== 'tree' && type !== 'commit')) continue;
      entries.push({
        path,
        mode: str(e.mode) ?? '100644',
        type,
        ...(typeof e.size === 'number' ? { size: e.size } : {}),
      });
    }
    return { entries, truncated: body.truncated === true || raw.length > MAX_TREE_ENTRIES };
  }

  async readFile(
    meta: RepoMeta,
    path: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<Buffer | null> {
    const url = `https://${RAW_HOST}/${encodeURIComponent(meta.owner)}/${encodeURIComponent(meta.repo)}/${meta.sha}/${encodePath(path)}`;
    const res = await this.get(url, signal, '*/*');
    if (res.status === 404) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    await this.guard(res);
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    return readCapped(res, maxBytes);
  }

  async history(meta: RepoMeta, signal: AbortSignal): Promise<HistorySignals> {
    const url = `https://${API_HOST}/repos/${encodeURIComponent(meta.owner)}/${encodeURIComponent(meta.repo)}/commits?sha=${meta.sha}&per_page=100`;
    const res = await this.get(url, signal, 'application/vnd.github+json');
    await this.guard(res);
    const list = await this.json(res);
    const commits = Array.isArray(list) ? list.map(obj) : [];
    const authors = new Set<string>();
    const dates: string[] = [];
    let low = 0;
    for (const c of commits) {
      const commit = obj(c.commit);
      const author = obj(commit.author);
      const who = str(obj(c.author).login) ?? str(author.email) ?? str(author.name);
      if (who) authors.add(who.toLowerCase());
      const date = str(author.date);
      if (date) dates.push(date);
      const firstLine = (str(commit.message) ?? '').split('\n')[0]!.trim();
      if (LOW_QUALITY_MESSAGE.test(firstLine) || firstLine.length < 4) low++;
    }
    dates.sort();
    return {
      totalCommits: commits.length,
      authors: authors.size,
      firstCommitAt: dates[0] ?? null,
      lastCommitAt: dates[dates.length - 1] ?? null,
      lowQualityMessageShare: commits.length ? Math.round((low / commits.length) * 100) / 100 : 0,
    };
  }
}

/** Stream a body, aborting once it passes maxBytes (null = too large). */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer | null> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
