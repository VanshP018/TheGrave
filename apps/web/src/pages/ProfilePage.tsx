import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SOCIAL_KEYS,
  type GameOutcome,
  type MatchHistoryPage,
  type ProfileView,
} from '@thegrave/shared';
import { useRef, useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router';
import { AppShell } from '../components/AppShell';
import { Avatar } from '../components/Avatar';
import { CameraIcon, GraduationCapIcon, PencilIcon } from '../components/play/icons';
import { ActivitySection } from '../components/profile/Activity';
import { ProfileEditor, SOCIAL } from '../components/profile/ProfileEditor';
import { RatingChart } from '../components/RatingChart';
import { BotBadge, btnSecondary, focusRing } from '../components/ui';
import { api, ApiRequestError } from '../lib/api';
import { toAvatarDataUrl } from '../lib/image';
import { useAuth } from '../stores/auth';

const REASON: Record<string, string> = {
  SOLVED: 'solved',
  TIMEOUT: 'on time',
  FORFEIT: 'forfeit',
  ABANDONED: 'abandoned',
  AGREED: 'draw agreed',
  RESIGNED: 'resigned',
};

/** Outcome is a status: text label first, the colored dot only reinforces it (never color alone). */
const OUTCOME: Record<GameOutcome, { label: string; dot: string; tone: string }> = {
  WIN: { label: 'Win', dot: 'bg-emerald-400/70', tone: 'text-emerald-300/90' },
  LOSS: { label: 'Loss', dot: 'bg-red-400/70', tone: 'text-red-300/90' },
  DRAW: { label: 'Draw', dot: 'bg-ash-400', tone: 'text-ash-300' },
};

/** A name for the rating band, so a number reads as a standing (decision.md D-071). */
function tier(rating: number): string {
  if (rating >= 2200) return 'Grandmaster';
  if (rating >= 2000) return 'Master';
  if (rating >= 1800) return 'Veteran';
  if (rating >= 1600) return 'Challenger';
  if (rating >= 1400) return 'Contender';
  return 'Initiate';
}

/** One figure in the stats strip: a label over a big number, no box. Label first keeps "Games30" readable. */
function Figure({
  label,
  value,
  tone = 'text-ink',
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.25em] text-ash-400">
        {label}
      </dt>
      <dd
        className={`mt-2 whitespace-nowrap font-mono text-3xl font-semibold tabular-nums sm:text-4xl ${tone}`}
      >
        {value}
      </dd>
    </div>
  );
}

/** The editable avatar: click (or keyboard) to pick a picture; it's cropped and shrunk in the browser. */
function AvatarControl({
  p,
  mine,
  onChanged,
}: {
  p: ProfileView;
  mine: boolean;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const image = await toAvatarDataUrl(file);
      const { avatarUrl } = await api<{ avatarUrl: string }>('/me/avatar', {
        method: 'PUT',
        json: { image },
      });
      // The navbar avatar reads the session user: update it in place.
      useAuth.setState((s) => (s.user ? { user: { ...s.user, avatarUrl } } : {}));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api('/me/avatar', { method: 'DELETE' });
      useAuth.setState((s) => (s.user ? { user: { ...s.user, avatarUrl: null } } : {}));
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const picture = (
    <span className="relative block">
      {/* A soft halo behind the picture. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-6 rounded-full bg-[radial-gradient(circle,rgb(92_184_255/0.16),transparent_65%)] blur-xl"
      />
      <Avatar username={p.username} url={p.avatarUrl} size={144} glow className="relative" />
    </span>
  );
  if (!mine) return picture;

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label="Change profile picture"
        className={`group relative cursor-pointer rounded-full ${focusRing}`}
      >
        {picture}
        <span className="absolute inset-0 grid place-items-center rounded-full bg-black/55 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="flex flex-col items-center gap-1 text-xs font-medium text-ink">
            <CameraIcon className="h-6 w-6" />
            {busy ? 'Uploading…' : 'Change photo'}
          </span>
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => void pick(e)}
        className="hidden"
        data-testid="avatar-input"
      />
      {p.avatarUrl && !busy && (
        <button
          type="button"
          onClick={() => void remove()}
          className={`cursor-pointer text-xs text-ash-400 underline-offset-4 hover:text-ink hover:underline ${focusRing}`}
        >
          Remove photo
        </button>
      )}
      {error && <p className="max-w-[12rem] text-center text-xs text-red-400">{error}</p>}
    </div>
  );
}

export function ProfilePage() {
  const { username = '' } = useParams();
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const [editing, setEditing] = useState(false);
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

  const mine = me?.username === p.username;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['profile', username] });
  const items = history.data?.pages.flatMap((pg) => pg.items) ?? [];
  const links = SOCIAL_KEYS.filter((k) => p.links[k]);
  const share = (n: number) => (p.games ? `${(n / p.games) * 100}%` : '0%');
  const pct = (n: number) => (p.games ? `${Math.round((n / p.games) * 100)}%` : '—');

  return (
    <AppShell wide>
      {/* ---- Hero ---------------------------------------------------------------------------------- */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(ellipse_60%_80%_at_20%_0%,rgb(92_184_255/0.07),transparent_70%)]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-14 pt-14 sm:px-6 lg:grid-cols-[auto_1fr_auto] lg:gap-14 lg:pt-20">
          <AvatarControl p={p} mine={mine} onChanged={refresh} />

          <div className="min-w-0 text-center lg:text-left">
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-azure">
              {tier(p.rating)}
              <span className="text-ash-400">
                {' · '}joined{' '}
                {new Date(p.joinedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </p>
            <h1 className="mt-3 truncate text-[clamp(2.5rem,7vw,5rem)] font-bold leading-[0.95] tracking-[-0.05em] text-ink">
              {p.username}
              {p.bot && <BotBadge className="ml-4 !text-xs !px-3 !py-0.5 align-middle" />}
            </h1>
            {p.institution && (
              <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-ash-300 lg:justify-start">
                <GraduationCapIcon className="size-4 shrink-0 text-ash-400" aria-hidden />
                <span className="truncate">{p.institution}</span>
              </p>
            )}
            {p.bio ? (
              <p className="mx-auto mt-5 max-w-xl whitespace-pre-line text-pretty text-[15px] font-light leading-relaxed text-ash-300 lg:mx-0">
                {p.bio}
              </p>
            ) : mine ? (
              <button
                onClick={() => setEditing(true)}
                className={`mt-5 cursor-pointer text-[15px] font-light text-ash-400 underline-offset-4 hover:text-ink hover:underline ${focusRing}`}
              >
                Add a bio so rivals know who they’re up against
              </button>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              {links.map((k) => {
                const { label, icon: Icon } = SOCIAL[k];
                return (
                  <a
                    key={k}
                    href={p.links[k]}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    aria-label={`${label} (opens in a new tab)`}
                    title={p.links[k]}
                    className={`grid h-10 w-10 place-items-center rounded-full bg-white/[0.05] text-ash-300 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/[0.1] hover:text-azure ${focusRing}`}
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                );
              })}
              {mine && (
                <button
                  onClick={() => setEditing(true)}
                  className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-white/[0.05] px-4 text-sm font-medium text-ink transition-colors hover:bg-white/[0.1] ${focusRing}`}
                >
                  <PencilIcon className="h-4 w-4" />
                  Edit profile
                </button>
              )}
            </div>
          </div>

          {/* The rating, as the page's one big number. */}
          <div className="text-center lg:text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-ash-400">
              Rating
            </p>
            <p className="mt-1 bg-gradient-to-b from-ink via-azure-light to-azure/80 bg-clip-text font-mono text-[clamp(3.5rem,8vw,6rem)] font-bold leading-none tracking-tighter text-transparent">
              {p.rating}
              {p.provisional && <span className="text-[0.5em] align-top">?</span>}
            </p>
            <p className="mt-2 text-sm text-ash-400">
              ±{p.rd}
              {p.provisional ? ' · provisional' : ''}
              {p.rank ? (
                <>
                  {' · '}
                  <Link to="/leaderboard" className="text-ink hover:text-azure">
                    #{p.rank}
                  </Link>
                </>
              ) : (
                ' · unranked'
              )}
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-16 px-4 pb-20 sm:px-6">
        {/* ---- Stats strip: games and peak, then the results split (decision.md D-072) -------------- */}
        <section aria-label="Stats" className="flex flex-wrap items-end gap-x-16 gap-y-10">
          <dl className="flex gap-x-16" data-testid="profile-stats">
            <Figure label="Games" value={p.games} />
          </dl>
          <div className="w-full max-w-md">
            <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {(
                [
                  ['Won', p.wins, 'bg-emerald-400/70'],
                  ['Drawn', p.draws, 'bg-ash-400/70'],
                  ['Lost', p.losses, 'bg-red-400/70'],
                ] as const
              ).map(([label, n, dot]) => (
                <div key={label} className="flex items-baseline gap-2">
                  <dt className="flex items-center gap-1.5 text-ash-400">
                    <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
                    {label}
                  </dt>
                  <dd className="font-mono tabular-nums">
                    <span className="font-semibold text-ink">{pct(n)}</span>{' '}
                    <span className="text-ash-400">({n})</span>
                  </dd>
                </div>
              ))}
            </dl>
            {/* The same split as a thin bar; the figures above are its text alternative. */}
            <div
              className="mt-3 flex h-1 gap-0.5 overflow-hidden rounded-full bg-white/[0.04]"
              aria-hidden
            >
              <span
                className="h-full rounded-full bg-emerald-400/55"
                style={{ width: share(p.wins) }}
              />
              <span
                className="h-full rounded-full bg-ash-400/50"
                style={{ width: share(p.draws) }}
              />
              <span
                className="h-full rounded-full bg-red-400/55"
                style={{ width: share(p.losses) }}
              />
            </div>
          </div>
        </section>

        {/* ---- Problems solved: points, heat map, streaks ------------------------------------------ */}
        <ActivitySection username={p.username} />

        {/* ---- Rating history ---------------------------------------------------------------------- */}
        <section aria-labelledby="rating-history">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.3em] text-azure">Form</p>
              <h2
                id="rating-history"
                className="mt-2 text-2xl font-semibold tracking-tight text-ink"
              >
                Rating history
              </h2>
            </div>
          </div>
          <RatingChart points={p.history} />
        </section>

        {/* ---- Match history ----------------------------------------------------------------------- */}
        <section aria-labelledby="match-history-title">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-azure">Record</p>
          <h2
            id="match-history-title"
            className="mt-2 text-2xl font-semibold tracking-tight text-ink"
          >
            Match history
          </h2>
          {items.length === 0 && !history.isLoading && (
            <p className="mt-6 text-sm text-ash-400">No rated matches yet.</p>
          )}
          <ul className="mt-6" data-testid="match-history">
            {items.map((m, i) => (
              <li
                key={m.matchId}
                className={`flex h-14 items-center gap-4 rounded-xl px-4 text-sm transition-colors sm:px-5 ${
                  i % 2 ? '' : 'bg-white/[0.03]'
                } hover:bg-white/[0.06]`}
              >
                <span
                  className={`flex w-14 shrink-0 items-center gap-1.5 font-medium ${OUTCOME[m.outcome].tone}`}
                >
                  <span className={`h-2 w-2 rounded-full ${OUTCOME[m.outcome].dot}`} aria-hidden />
                  {OUTCOME[m.outcome].label}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink">
                  vs{' '}
                  <Link to={`/u/${m.opponent.username}`} className="hover:text-azure">
                    {m.opponent.username}
                  </Link>{' '}
                  {m.opponent.bot && <BotBadge className="mr-1" />}
                  <span className="text-ash-400">({m.opponent.rating})</span>
                </span>
                <span className="hidden min-w-0 truncate text-ash-400 md:block md:w-56">
                  {m.problem.title} · {REASON[m.endReason]}
                </span>
                <span className="w-24 shrink-0 text-right font-mono tabular-nums text-ink">
                  <span className={m.delta > 0 ? 'text-azure' : 'text-ash-300'}>
                    {m.delta > 0 ? '+' : ''}
                    {m.delta}
                  </span>{' '}
                  → {m.ratingAfter}
                </span>
                <span className="hidden w-24 shrink-0 text-right text-xs text-ash-400 sm:block">
                  {new Date(m.at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
          {history.hasNextPage && (
            <button
              onClick={() => void history.fetchNextPage()}
              disabled={history.isFetchingNextPage}
              className={`${btnSecondary} mt-4 rounded-md`}
            >
              {history.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </section>
      </div>

      {editing && <ProfileEditor profile={p} onClose={() => setEditing(false)} onSaved={refresh} />}
    </AppShell>
  );
}
