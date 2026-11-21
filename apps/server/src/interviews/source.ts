import type { RepoRef } from '@thegrave/shared';
import { InterviewError } from './errors.js';

export interface RepoMeta {
  owner: string;
  repo: string;
  displayName: string;
  description: string | null;
  defaultBranch: string;
  sha: string;
  sizeKb: number;
  fork: boolean;
  archived: boolean;
  pushedAt: string;
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  size?: number;
}

export interface HistorySignals {
  totalCommits: number;
  authors: number;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
  lowQualityMessageShare: number;
}

/** Where a repository's files come from. Implementations throw InterviewError; tests use MemoryRepoSource. */
export interface RepoSource {
  resolve(ref: RepoRef, signal: AbortSignal): Promise<RepoMeta>;
  tree(meta: RepoMeta, signal: AbortSignal): Promise<{ entries: TreeEntry[]; truncated: boolean }>;
  /** null = skipped (missing, or larger than maxBytes). */
  readFile(
    meta: RepoMeta,
    path: string,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<Buffer | null>;
  history(meta: RepoMeta, signal: AbortSignal): Promise<HistorySignals>;
}

const DEFAULT_HISTORY: HistorySignals = {
  totalCommits: 60,
  authors: 2,
  firstCommitAt: '2024-01-01T00:00:00Z',
  lastCommitAt: '2024-06-01T00:00:00Z',
  lowQualityMessageShare: 0.1,
};

export interface MemoryRepoOptions {
  description?: string | null;
  history?: Partial<HistorySignals>;
  sha?: string;
  /** Extra tree entries (symlinks, submodules) that have no content. */
  extraEntries?: TreeEntry[];
}

/** A repository held in memory ({ path: content }): the fixture source for tests and E2E. Never touches the network. */
export class MemoryRepoSource implements RepoSource {
  constructor(
    private readonly files: Record<string, string | Buffer>,
    private readonly opts: MemoryRepoOptions = {},
  ) {}

  async resolve(ref: RepoRef): Promise<RepoMeta> {
    if (Object.keys(this.files).length === 0) throw new InterviewError('REPO_EMPTY');
    return {
      owner: ref.owner,
      repo: ref.repo,
      displayName: `${ref.owner}/${ref.repo}`,
      description: this.opts.description ?? null,
      defaultBranch: 'main',
      sha: this.opts.sha ?? 'a'.repeat(40),
      sizeKb: Math.ceil(
        Object.values(this.files).reduce((n, c) => n + Buffer.byteLength(c), 0) / 1024,
      ),
      fork: false,
      archived: false,
      pushedAt: '2024-06-01T00:00:00Z',
    };
  }

  async tree(): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const entries: TreeEntry[] = Object.entries(this.files).map(([path, c]) => ({
      path,
      mode: '100644',
      type: 'blob',
      size: Buffer.byteLength(c),
    }));
    return { entries: [...entries, ...(this.opts.extraEntries ?? [])], truncated: false };
  }

  async readFile(_meta: RepoMeta, path: string, maxBytes: number): Promise<Buffer | null> {
    const c = this.files[path];
    if (c === undefined) return null;
    const buf = Buffer.isBuffer(c) ? c : Buffer.from(c, 'utf8');
    return buf.length > maxBytes ? null : buf;
  }

  async history(): Promise<HistorySignals> {
    return { ...DEFAULT_HISTORY, ...this.opts.history };
  }
}
