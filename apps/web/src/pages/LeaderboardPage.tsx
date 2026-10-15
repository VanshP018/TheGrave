import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { LeaderboardPage as Page } from '@thegrave/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { AppShell } from '../components/AppShell';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';

const PAGE_SIZE = 25;

export function LeaderboardPage() {
  const [offset, setOffset] = useState(0);
  const me = useAuth((s) => s.user?.id);
  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', offset],
    queryFn: () => api<Page>(`/leaderboard?offset=${offset}&limit=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });

  return (
    <AppShell>
      <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Leaderboard</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Players appear after a few rated games. A “?” marks a provisional rating.
            </p>
          </div>
          <p className="text-sm text-zinc-400" data-testid="my-rank">
            {data?.me ? (
              <>
                You are <span className="font-semibold text-zinc-100">#{data.me.rank}</span> of{' '}
                {data.total}
              </>
            ) : data ? (
              'Play a few rated games to get ranked.'
            ) : null}
          </p>
        </div>

        <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Rank</th>
                <th className="px-4 py-2 font-medium">Player</th>
                <th className="px-4 py-2 text-right font-medium">Rating</th>
                <th className="px-4 py-2 text-right font-medium">Games</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data?.entries.map((e) => (
                <tr
                  key={e.userId}
                  className={`border-t border-zinc-800 ${e.userId === me ? 'bg-zinc-900' : ''}`}
                  aria-current={e.userId === me ? 'true' : undefined}
                >
                  <td className="px-4 py-2 text-zinc-400">{e.rank}</td>
                  <td className="px-4 py-2">
                    <Link to={`/u/${e.username}`} className="hover:underline">
                      {e.username}
                    </Link>
                    {e.userId === me && <span className="ml-2 text-xs text-zinc-500">you</span>}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {e.rating}
                    {e.provisional && (
                      <span className="text-zinc-500" title="Provisional rating">
                        ?
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-400">{e.games}</td>
                </tr>
              ))}
              {data && !data.entries.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                    Nobody is ranked yet.
                  </td>
                </tr>
              )}
              {isLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {data && data.total > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="rounded-md border border-zinc-700 px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-zinc-500">
              {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} of {data.total}
            </span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= data.total}
              className="rounded-md border border-zinc-700 px-3 py-1.5 hover:bg-zinc-800 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </section>
    </AppShell>
  );
}
