import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { LeaderboardPage as Page, LeaderboardScope } from '@thegrave/shared';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AppShell } from '../components/AppShell';
import { GraduationCapIcon } from '../components/play/icons';
import { btnSecondary, focusRing, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';

const PAGE_SIZE = 25;

/** The podium gets the brand's accent; everyone else reads in grey. */
const rankTone = (rank: number) =>
  rank === 1 ? 'text-azure font-semibold' : rank <= 3 ? 'text-azure-light' : 'text-ash-300';

/** Global or campus (decision.md D-079). The choice lives in the URL, so a view can be shared. */
function ScopeToggle(props: {
  scope: LeaderboardScope;
  onChange: (s: LeaderboardScope) => void;
  institution: string | null | undefined;
}) {
  const { scope, onChange, institution } = props;
  const options = [
    { id: 'global', label: 'Global' },
    { id: 'university', label: 'My university' },
  ] as const;
  return (
    <div
      className="flex rounded-full bg-white/[0.05] p-1"
      role="group"
      aria-label="Leaderboard scope"
    >
      {options.map((o) => {
        const noSchool = o.id === 'university' && institution === null;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            aria-pressed={scope === o.id}
            disabled={noSchool}
            title={noSchool ? 'Your account has no school or college on record' : undefined}
            className={`h-8 cursor-pointer rounded-full px-4 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${focusRing} ${
              scope === o.id ? 'bg-white/[0.1] text-ink' : 'text-ash-300 hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function LeaderboardPage() {
  const [params, setParams] = useSearchParams();
  const scope: LeaderboardScope = params.get('scope') === 'university' ? 'university' : 'global';
  const [offset, setOffset] = useState(0);
  const me = useAuth((s) => s.user?.id);
  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard', scope, offset],
    queryFn: () => api<Page>(`/leaderboard?scope=${scope}&offset=${offset}&limit=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });

  const campus = scope === 'university';
  const setScope = (next: LeaderboardScope) => {
    setOffset(0);
    setParams(next === 'global' ? {} : { scope: next }, { replace: true });
  };

  return (
    <AppShell>
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <PageHeader eyebrow={campus ? 'Campus' : 'Ranked'} title="Leaderboard">
            {campus ? (
              <span className="inline-flex h-5 items-center gap-2">
                <GraduationCapIcon className="h-4 w-4 text-ash-400" />
                {data?.institution ?? 'Your school or college'}
              </span>
            ) : (
              'Players appear after a few rated games. A “?” marks a provisional rating.'
            )}
          </PageHeader>
          <ScopeToggle scope={scope} onChange={setScope} institution={data?.institution} />
        </div>

        <p className="mt-8 text-sm text-ash-300" data-testid="my-rank">
          {data?.me ? (
            <>
              You are <span className="font-mono font-semibold text-azure">#{data.me.rank}</span> of{' '}
              {data.total}
              {campus && data.institution ? ` at ${data.institution}` : ''}
            </>
          ) : data ? (
            'Play a few rated games to get ranked.'
          ) : null}
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-separate border-spacing-y-0 text-sm">
            <thead className="text-left text-[11px] uppercase tracking-widest text-ash-400">
              <tr>
                <th className="px-4 py-3 font-medium">Rank</th>
                <th className="px-4 py-3 font-medium">Player</th>
                {!campus && <th className="hidden px-4 py-3 font-medium md:table-cell">School</th>}
                <th className="px-4 py-3 text-right font-medium">Rating</th>
                <th className="px-4 py-3 text-right font-medium">Games</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {data?.entries.map((e, i) => {
                const mine = e.userId === me;
                // Alternating tint with rounded ends, like the practice lists: no box around the table.
                const cell = `${i % 2 ? '' : 'bg-white/[0.03]'} ${mine ? '!bg-azure/[0.07]' : ''} px-4 py-3.5 transition-colors group-hover:bg-white/[0.07]`;
                return (
                  <tr key={e.userId} className="group" aria-current={mine ? 'true' : undefined}>
                    <td
                      className={`${cell} rounded-l-xl font-mono ${rankTone(e.rank)} ${
                        mine ? 'shadow-[inset_2px_0_0_var(--color-azure)]' : ''
                      }`}
                    >
                      {e.rank}
                    </td>
                    <td className={cell}>
                      <Link
                        to={`/u/${e.username}`}
                        className={`text-ink underline-offset-4 hover:text-azure hover:underline ${focusRing}`}
                      >
                        {e.username}
                      </Link>
                      {mine && (
                        <span className="ml-2 rounded-full bg-azure/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-azure">
                          you
                        </span>
                      )}
                    </td>
                    {!campus && (
                      <td className={`${cell} hidden max-w-56 truncate text-ash-400 md:table-cell`}>
                        {e.institution ?? '—'}
                      </td>
                    )}
                    <td className={`${cell} text-right font-mono text-ink`}>
                      {e.rating}
                      {e.provisional && (
                        <span className="text-ash-400" title="Provisional rating">
                          ?
                        </span>
                      )}
                    </td>
                    <td className={`${cell} rounded-r-xl text-right text-ash-300`}>{e.games}</td>
                  </tr>
                );
              })}
              {data && !data.entries.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-ash-400">
                    {campus && !data.institution
                      ? 'Your account has no school or college on record.'
                      : campus
                        ? `Nobody from ${data.institution} is ranked yet.`
                        : 'Nobody is ranked yet.'}
                  </td>
                </tr>
              )}
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-ash-400">
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
