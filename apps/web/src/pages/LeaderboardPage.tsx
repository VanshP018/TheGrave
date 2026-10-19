import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { LeaderboardPage as Page } from '@thegrave/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { AppShell } from '../components/AppShell';
import { btnSecondary, card, focusRing, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';

const PAGE_SIZE = 25;

/** The podium gets the brand's metal; everyone else reads in grey. */
const rankTone = (rank: number) =>
  rank === 1 ? 'text-azure font-semibold' : rank <= 3 ? 'text-azure-light' : 'text-ash-300';

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
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PageHeader eyebrow="Ranked" title="Leaderboard">
            Players appear after a few rated games. A “?” marks a provisional rating.
          </PageHeader>
          <p className="text-sm text-ash-300" data-testid="my-rank">
            {data?.me ? (
              <>
                You are <span className="font-mono font-semibold text-azure">#{data.me.rank}</span>{' '}
                of {data.total}
              </>
            ) : data ? (
              'Play a few rated games to get ranked.'
            ) : null}
          </p>
        </div>

        <div className={`${card} mt-8 overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="border-b border-ash-700 text-left text-[11px] uppercase tracking-widest text-ash-400">
              <tr>
                <th className="px-4 py-3 font-medium">Rank</th>
                <th className="px-4 py-3 font-medium">Player</th>
                <th className="px-4 py-3 text-right font-medium">Rating</th>
                <th className="px-4 py-3 text-right font-medium">Games</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data?.entries.map((e) => (
                <tr
                  key={e.userId}
                  className={`border-t border-ash-800 transition-colors duration-150 first:border-t-0 hover:bg-ash-800/60 ${
                    e.userId === me
                      ? 'bg-azure/[0.06] shadow-[inset_2px_0_0_var(--color-azure)]'
                      : ''
                  }`}
                  aria-current={e.userId === me ? 'true' : undefined}
                >
                  <td className={`px-4 py-3 font-mono ${rankTone(e.rank)}`}>{e.rank}</td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/u/${e.username}`}
                      className={`text-ink underline-offset-4 hover:text-azure hover:underline ${focusRing}`}
                    >
                      {e.username}
                    </Link>
                    {e.userId === me && (
                      <span className="ml-2 rounded-sm border border-azure/40 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-azure">
                        you
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-ink">
                    {e.rating}
                    {e.provisional && (
                      <span className="text-ash-400" title="Provisional rating">
                        ?
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-ash-300">{e.games}</td>
                </tr>
              ))}
              {data && !data.entries.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-ash-400">
                    Nobody is ranked yet.
                  </td>
                </tr>
              )}
              {isLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-ash-400">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {data && data.total > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className={btnSecondary}
            >
              Previous
            </button>
            <span className="text-ash-400">
              {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} of {data.total}
            </span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= data.total}
              className={btnSecondary}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </AppShell>
  );
}
