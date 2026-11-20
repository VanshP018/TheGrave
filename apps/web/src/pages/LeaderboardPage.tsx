import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type {
  LeaderboardPage as RatingPage,
  LeaderboardScope,
  PointsLeaderboardPage as PointsPage,
} from '@thegrave/shared';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AppShell } from '../components/AppShell';
import { GraduationCapIcon } from '../components/play/icons';
import { btnSecondary, focusRing, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';

const PAGE_SIZE = 25;

/** What the board ranks by: the Glicko rating from battles, or points for problems solved. */
type Metric = 'rating' | 'problems';

/** The podium gets the brand's accent; everyone else reads in grey. */
const rankTone = (rank: number) =>
  rank === 1 ? 'text-azure font-semibold' : rank <= 3 ? 'text-azure-light' : 'text-ash-300';

/** A small pill group; both toggles share it so they look and behave the same. */
function Segmented<T extends string>(props: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly { id: T; label: string; disabled?: boolean; title?: string }[];
}) {
  const { label, value, onChange, options } = props;
  return (
    <div className="flex rounded-full bg-white/[0.05] p-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          disabled={o.disabled}
          title={o.title}
          className={`h-8 cursor-pointer rounded-full px-4 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${focusRing} ${
            value === o.id ? 'bg-white/[0.1] text-ink' : 'text-ash-300 hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One normalised row, so the table body is the same for both metrics. */
interface Row {
  rank: number;
  userId: string;
  username: string;
  institution: string | null;
  main: React.ReactNode;
  side: React.ReactNode;
  sideTitle?: string;
}

export function LeaderboardPage() {
  const [params, setParams] = useSearchParams();
  const scope: LeaderboardScope = params.get('scope') === 'university' ? 'university' : 'global';
  const metric: Metric = params.get('metric') === 'problems' ? 'problems' : 'rating';
  const [offset, setOffset] = useState(0);
  const me = useAuth((s) => s.user?.id);

  const ratingQ = useQuery({
    queryKey: ['leaderboard', 'rating', scope, offset],
    queryFn: () =>
      api<RatingPage>(`/leaderboard?scope=${scope}&offset=${offset}&limit=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
    enabled: metric === 'rating',
  });
  const problemsQ = useQuery({
    queryKey: ['leaderboard', 'problems', scope, offset],
    queryFn: () =>
      api<PointsPage>(`/leaderboard/problems?scope=${scope}&offset=${offset}&limit=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
    enabled: metric === 'problems',
  });
  const isLoading = metric === 'rating' ? ratingQ.isLoading : problemsQ.isLoading;
  const data = metric === 'rating' ? ratingQ.data : problemsQ.data;

  const campus = scope === 'university';
  const byRating = metric === 'rating';
  const update = (next: { scope?: LeaderboardScope; metric?: Metric }) => {
    const s = next.scope ?? scope;
    const m = next.metric ?? metric;
    setOffset(0);
    setParams(
      {
        ...(m === 'problems' && { metric: m }),
        ...(s === 'university' && { scope: s }),
      },
      { replace: true },
    );
  };

  const rows: Row[] =
    metric === 'rating'
      ? (ratingQ.data?.entries ?? []).map((e) => ({
          rank: e.rank,
          userId: e.userId,
          username: e.username,
          institution: e.institution,
          main: (
            <>
              {e.rating}
              {e.provisional && (
                <span className="text-ash-400" title="Provisional rating">
                  ?
                </span>
              )}
            </>
          ),
          side: e.games,
        }))
      : (problemsQ.data?.entries ?? []).map((e) => ({
          rank: e.rank,
          userId: e.userId,
          username: e.username,
          institution: e.institution,
          main: e.points,
          side: e.solved,
          sideTitle: `${e.dsa} DSA · ${e.programming} programming`,
        }));

  const mine = data?.me ?? null;
  const myRank = mine?.rank;
  const myValue = mine ? ('rating' in mine ? mine.rating : mine.points) : null;
  const emptyMessage =
    campus && !data?.institution
      ? 'Your account has no school or college on record.'
      : campus
        ? `Nobody from ${data?.institution} is ranked yet.`
        : 'Nobody is ranked yet.';

  return (
    <AppShell>
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <PageHeader
            eyebrow={`${campus ? 'Campus' : 'Global'} · ${byRating ? 'Rating' : 'Problems'}`}
            title="Leaderboard"
          >
            {campus ? (
              <span className="inline-flex h-5 items-center gap-2">
                <GraduationCapIcon className="h-4 w-4 text-ash-400" />
                {data?.institution ?? 'Your school or college'}
              </span>
            ) : byRating ? (
              'Players appear after a few rated games. A “?” marks a provisional rating.'
            ) : (
              'Points for problems solved: 1 per easy, 3 per medium, 5 per hard. DSA and programming count together.'
            )}
          </PageHeader>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented<Metric>
              label="Leaderboard type"
              value={metric}
              onChange={(m) => update({ metric: m })}
              options={[
                { id: 'rating', label: 'Rating' },
                { id: 'problems', label: 'Problems' },
              ]}
            />
            <Segmented<LeaderboardScope>
              label="Leaderboard scope"
              value={scope}
              onChange={(s) => update({ scope: s })}
              options={[
                { id: 'global', label: 'Global' },
                {
                  id: 'university',
                  label: 'My university',
                  disabled: data?.institution === null,
                  title:
                    data?.institution === null
                      ? 'Your account has no school or college on record'
                      : undefined,
                },
              ]}
            />
          </div>
        </div>

        <p className="mt-8 text-sm text-ash-300" data-testid="my-rank">
          {mine ? (
            <>
              You are <span className="font-mono font-semibold text-azure">#{myRank}</span> of{' '}
              {data?.total}
              {campus && data?.institution ? ` at ${data.institution}` : ''}
              {!byRating && ` with ${myValue} point${myValue === 1 ? '' : 's'}`}
            </>
          ) : data ? (
            byRating ? (
              'Play a few rated games to get ranked.'
            ) : (
              'Solve a problem to get ranked.'
            )
          ) : null}
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-separate border-spacing-y-0 text-sm">
            <thead className="text-left text-[11px] uppercase tracking-widest text-ash-400">
              <tr>
                <th className="px-4 py-3 font-medium">Rank</th>
                <th className="px-4 py-3 font-medium">Player</th>
                {!campus && <th className="hidden px-4 py-3 font-medium md:table-cell">School</th>}
                <th className="px-4 py-3 text-right font-medium">
                  {byRating ? 'Rating' : 'Points'}
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  {byRating ? 'Games' : 'Solved'}
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((e, i) => {
                const isMe = e.userId === me;
                // Alternating tint with rounded ends, like the practice lists: no box around the table.
                const cell = `${i % 2 ? '' : 'bg-white/[0.03]'} ${isMe ? '!bg-azure/[0.07]' : ''} px-4 py-3.5 transition-colors group-hover:bg-white/[0.07]`;
                return (
                  <tr key={e.userId} className="group" aria-current={isMe ? 'true' : undefined}>
                    <td
                      className={`${cell} rounded-l-xl font-mono ${rankTone(e.rank)} ${
                        isMe ? 'shadow-[inset_2px_0_0_var(--color-azure)]' : ''
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
                      {isMe && (
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
                    <td className={`${cell} text-right font-mono text-ink`}>{e.main}</td>
                    <td
                      className={`${cell} rounded-r-xl text-right text-ash-300`}
                      title={e.sideTitle}
                    >
                      {e.side}
                    </td>
                  </tr>
                );
              })}
              {data && !rows.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-ash-400">
                    {emptyMessage}
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
