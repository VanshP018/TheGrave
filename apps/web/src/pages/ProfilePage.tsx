import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { GameOutcome, MatchHistoryPage, ProfileView } from '@thegrave/shared';
import { useParams } from 'react-router';
import { AppShell } from '../components/AppShell';
import { RatingChart } from '../components/RatingChart';
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
  DRAW: { label: 'Draw', dot: 'bg-zinc-500' },
};

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-100">{value}</p>
      {sub && <p className="text-xs text-zinc-500">{sub}</p>}
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
        <p className="p-10 text-center text-zinc-400">
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
        <p className="p-10 text-center text-zinc-500">Loading…</p>
      </AppShell>
    );
  }

  const decided = p.wins + p.losses;
  const items = history.data?.pages.flatMap((pg) => pg.items) ?? [];

  return (
    <AppShell>
      <section className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold">{p.username}</h1>
          <p className="text-sm text-zinc-500">
            Joined {new Date(p.joinedAt).toLocaleDateString()}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="profile-stats">
          <Stat
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
          <Stat label="Wins / losses / draws" value={`${p.wins} / ${p.losses} / ${p.draws}`} />
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="mb-2 text-sm font-semibold text-zinc-300">Rating history</h2>
          <RatingChart points={p.history} />
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-zinc-300">Match history</h2>
          {items.length === 0 && !history.isLoading && (
            <p className="text-sm text-zinc-500">No rated matches yet.</p>
          )}
          <ul
            className="divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800"
            data-testid="match-history"
          >
            {items.map((m) => (
              <li key={m.matchId} className="px-4 py-2.5 text-sm">
                <div className="flex items-center gap-3">
                  <span className="flex w-14 shrink-0 items-center gap-1.5 font-medium">
                    <span
                      className={`h-2 w-2 rounded-full ${OUTCOME[m.outcome].dot}`}
                      aria-hidden
                    />
                    {OUTCOME[m.outcome].label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-zinc-300">
                    vs {m.opponent.username}{' '}
                    <span className="text-zinc-500">({m.opponent.rating})</span>
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-zinc-200">
                    {m.delta > 0 ? '+' : ''}
                    {m.delta} → {m.ratingAfter}
                  </span>
                </div>
                <div className="mt-0.5 flex justify-between gap-3 pl-[4.25rem] text-xs text-zinc-500">
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
              className="mt-3 rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
            >
              {history.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </section>
    </AppShell>
  );
}
