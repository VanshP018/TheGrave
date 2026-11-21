import type { Redis } from 'ioredis';
import type { RepoRef } from '@thegrave/shared';
import type { HistorySignals, RepoMeta, RepoSource, TreeEntry } from './source.js';

export const TREE_TTL_SECONDS = 24 * 60 * 60;

type Tree = { entries: TreeEntry[]; truncated: boolean };

export const treeCacheKey = (meta: Pick<RepoMeta, 'owner' | 'repo' | 'sha'>) =>
  `interviews:gh:${meta.owner.toLowerCase()}/${meta.repo.toLowerCase()}@${meta.sha}:tree`;

/**
 * Wraps a RepoSource so the git tree of a commit is fetched once per 24 h (plan.md 6.2). A tree is immutable for
 * a SHA, so retries, delayed jobs and other users' analyses of the same commit cost no GitHub calls. Metadata is
 * never cached: it is what tells us the current SHA. Cache failures fall through to the source.
 */
export class TreeCachedSource implements RepoSource {
  constructor(
    private readonly inner: RepoSource,
    private readonly redis: Redis,
    private readonly ttlSeconds = TREE_TTL_SECONDS,
  ) {}

  resolve(ref: RepoRef, signal: AbortSignal): Promise<RepoMeta> {
    return this.inner.resolve(ref, signal);
  }

  async tree(meta: RepoMeta, signal: AbortSignal): Promise<Tree> {
    const key = treeCacheKey(meta);
    try {
      const hit = await this.redis.get(key);
      if (hit) {
        const parsed = JSON.parse(hit) as Tree;
        if (Array.isArray(parsed.entries)) return parsed;
      }
    } catch {
      // a broken cache entry or Redis hiccup is just a miss
    }
    const tree = await this.inner.tree(meta, signal);
    if (tree.entries.length > 0)
      await this.redis.set(key, JSON.stringify(tree), 'EX', this.ttlSeconds).catch(() => undefined);
    return tree;
  }

  readFile(meta: RepoMeta, path: string, maxBytes: number, signal: AbortSignal) {
    return this.inner.readFile(meta, path, maxBytes, signal);
  }

  history(meta: RepoMeta, signal: AbortSignal): Promise<HistorySignals> {
    return this.inner.history(meta, signal);
  }
}
