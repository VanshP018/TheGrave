import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { GameOutcome, MatchHistoryPage, ProfileView } from '@thegrave/shared';
import { useParams } from 'react-router';
import { AppShell } from '../components/AppShell';
import { RatingChart } from '../components/RatingChart';
import { btnSecondary, card, Eyebrow } from '../components/ui';
import { api, ApiRequestError } from '../lib/api';

const REASON: Record<string, string> = {
  SOLVED: 'solved',
  TIMEOUT: 'on time',
  FORFEIT: 'forfeit',
  ABANDONED: 'abandoned',
};

/** Outcome is a status: text label first, the colored dot only reinforces it (never color alone). */
const OUTCOME: Record<GameOutcome, { label: string; dot: string }> = {
  WIN: { label: 'Win', dot: 'bg-emerald-500' },
  LOSS: { label: 'Loss', dot: 'bg-red-500' },
  DRAW: { label: 'Draw', dot: 'bg-ash-400' },
};

function Stat(props: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`${card} px-4 py-4 ${props.accent ? 'border-azure/40' : ''}`}>
      <p className="text-[11px] uppercase tracking-widest text-ash-400">{props.label}</p>
      <p
        className={`mt-2 whitespace-nowrap font-mono text-2xl font-semibold tabular-nums ${props.accent ? 'text-azure' : 'text-ink'}`}
      >
        {props.value}
      </p>
      {props.sub && <p className="mt-0.5 text-xs text-ash-400">{props.sub}</p>}
    </div>
  );
}

export function ProfilePage() {
  const { username = '' } = useParams();
  const { data: p, error } = useQuery({
    queryKey: ['profile', username],
    queryFn: () => api<ProfileView>(`/users/${encodeURIComponent(username)}`),
  });
  const history = useInfiniteQuery({
    queryKey: ['profile', username, 'matches'],
    queryFn: ({ pageParam }) =>
      api<MatchHistoryPage>(
        `/users/${encodeURIComponent(username)}/matches?limit=15${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  if (error) {
    return (
      <AppShell>
        <p className="p-10 text-center text-ash-300">
          {error instanceof ApiRequestError && error.status === 404
            ? 'No such player.'
            : 'Could not load this profile.'}
        </p>
      </AppShell>
    );
  }
  if (!p) {
    return (
      <AppShell>
        <p className="p-10 text-center text-ash-400">Loading…</p>
      </AppShell>
    );
  }

  const decided = p.wins + p.losses;
  const items = history.data?.pages.flatMap((pg) => pg.items) ?? [];

  return (
    <AppShell>
      <section className="mx-auto max-w-4xl space-y-6 px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex items-center gap-4">
          {/* Monogram: no avatars exist, and a blue initial is more on-brand than a grey silhouette. */}
          <span
            aria-hidden
            className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-azure/50 bg-ash-900 text-xl font-semibold uppercase text-azure"
          >
            {p.username[0]}
          </span>
          <div>
            <Eyebrow>Player</Eyebrow>
            <h1 className="mt-1 text-[clamp(1.5rem,4vw,2.25rem)] font-semibold leading-tight tracking-[-0.03em]">
              {p.username}
            </h1>
            <p className="text-sm text-ash-400">
              Joined {new Date(p.joinedAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="profile-stats">
          <Stat
            accent
            label="Rating"
            value={`${p.rating}${p.provisional ? '?' : ''}`}
            sub={`±${p.rd}${p.provisional ? ' · provisional' : ''}`}
          />
          <Stat
            label="Rank"
            value={p.rank ? `#${p.rank}` : '—'}
            sub={p.rank ? undefined : 'not ranked yet'}
          />
          <Stat
            label="Games"
            value={p.games}
            sub={decided ? `${Math.round((p.wins / decided) * 100)}% won` : undefined}
          />
          <Stat label="Wins / losses / draws" value={`${p.wins}–${p.losses}–${p.draws}`} />
        </div>

        <div className={`${card} p-4 sm:p-5`}>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-ash-300">
            Rating history
          </h2>
          <RatingChart points={p.history} />
        </div>

        <div>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-ash-300">
            Match history
          </h2>
          {items.length === 0 && !history.isLoading && (
            <p className="text-sm text-ash-400">No rated matches yet.</p>
          )}
          <ul
            className={`${card} divide-y divide-ash-800 overflow-hidden`}
            data-testid="match-history"
          >
            {items.map((m) => (
              <li
                key={m.matchId}
                className="px-4 py-3 text-sm transition-colors duration-150 hover:bg-ash-800/60"
              >
                <div className="flex items-center gap-3">
                  <span className="flex w-14 shrink-0 items-center gap-1.5 font-medium">
                    <span
                      className={`h-2 w-2 rounded-full ${OUTCOME[m.outcome].dot}`}
                      aria-hidden
                    />
                    {OUTCOME[m.outcome].label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ash-300">
                    vs {m.opponent.username}{' '}
                    <span className="text-ash-400">({m.opponent.rating})</span>
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-ink">
                    <span className={m.delta > 0 ? 'text-azure' : 'text-ash-300'}>
                      {m.delta > 0 ? '+' : ''}
                      {m.delta}
                    </span>{' '}
                    → {m.ratingAfter}
                  </span>
                </div>
                <div className="mt-0.5 flex justify-between gap-3 pl-[4.25rem] text-xs text-ash-400">
                  <span className="truncate">
                    {m.problem.title} · {REASON[m.endReason]}
                  </span>
                  <span className="shrink-0">{new Date(m.at).toLocaleDateString()}</span>
                </div>
              </li>
            ))}
          </ul>
          {history.hasNextPage && (
            <button
              onClick={() => void history.fetchNextPage()}
              disabled={history.isFetchingNextPage}
              className={`${btnSecondary} mt-3`}
            >
              {history.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </section>
    </AppShell>
  );
}
