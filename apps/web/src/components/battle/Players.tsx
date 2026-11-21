import type { BattleView, PlayerProgress } from '@thegrave/shared';
import { Avatar } from '../Avatar';
import { BotBadge } from '../ui';
import { clock } from './format';
import { SectionTitle } from './Statement';

/**
 * A player in the battle bar (decision.md D-068): an avatar (their initial; there are no uploads), a thin
 * progress bar and the tests passed. Names stay out of the bar (they're in the tooltip and for screen
 * readers); your own avatar is ringed with a blue glow instead of a "You" label.
 */
export function PlayerChip(props: {
  p: PlayerProgress;
  total: number | null;
  me?: boolean;
  now: number;
  testId?: string;
}) {
  const { p, total, me, now, testId } = props;
  const pct = total ? Math.round((p.bestPassed / total) * 100) : 0;
  return (
    <div
      className={`flex items-center gap-2.5 ${me ? 'flex-row' : 'flex-row-reverse'}`}
      data-testid={testId}
      title={`${p.username} · ${p.rating} · ${p.attempts} ${p.attempts === 1 ? 'attempt' : 'attempts'}${p.pending ? ', judging' : ''}`}
    >
      <span className="sr-only">
        {me ? 'You' : 'Opponent'}: {p.username}
        {p.bot ? ' (practice bot)' : ''}
      </span>
      <span className="relative shrink-0">
        <Avatar username={p.username} url={p.avatarUrl} size={36} glow={me} />
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-hero-bg ${
            p.connected ? 'bg-emerald-400' : 'bg-orange-400'
          }`}
          title={p.connected ? 'Connected' : 'Away'}
        />
      </span>
      <div className={`flex w-20 flex-col gap-1 ${me ? 'items-start' : 'items-end'}`}>
        <div className="h-1 w-full overflow-hidden rounded-full bg-ash-700">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${me ? 'bg-azure' : 'bg-ash-300'} ${me ? '' : 'ml-auto'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span
          className="font-mono text-[11px] leading-4 tabular-nums text-ash-300"
          data-testid={testId && `${testId}-passed`}
        >
          {p.bestPassed}/{total ?? '?'} tests
        </span>
      </div>
      {p.bot && <BotBadge />}
      {!p.connected && (
        <span className="shrink-0 text-[11px] font-medium text-orange-400">
          away {p.graceEndsAt ? clock(p.graceEndsAt - now) : ''}
        </span>
      )}
    </div>
  );
}

function PlayerDetail({ p, total, me }: { p: PlayerProgress; total: number | null; me?: boolean }) {
  const pct = total ? Math.round((p.bestPassed / total) * 100) : 0;
  return (
    <div className={`rounded-md border p-4 ${me ? 'border-azure/30' : 'border-ash-700'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate font-semibold text-ink">
          {p.username}
          {p.bot && <BotBadge className="ml-2" />}
        </p>
        <p className="font-mono text-sm text-ash-300">{p.rating}</p>
      </div>
      <p className="text-xs text-ash-400">{me ? 'You' : 'Opponent'}</p>
      <div className="mt-4 flex items-end justify-between">
        <p className="font-mono text-3xl font-semibold tabular-nums text-ink">
          {p.bestPassed}
          <span className="text-base text-ash-400">/{total ?? '?'}</span>
        </p>
        <p className="text-xs text-ash-300">{pct}% passed</p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ash-700">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${me ? 'bg-azure' : 'bg-ash-300'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
        {[
          ['Attempts', p.attempts],
          ['Judging', p.pending],
          ['Status', p.solved ? 'Solved' : p.connected ? 'Online' : 'Away'],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-ash-400">{k}</dt>
            <dd className="mt-0.5 font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The "Match" tab: both players side by side, and how this match will be decided. */
export function MatchPanel({
  view,
  mine,
  theirs,
}: {
  view: BattleView;
  mine: PlayerProgress;
  theirs: PlayerProgress;
}) {
  return (
    <div className="space-y-4 px-5 py-5 sm:px-6">
      <h2 className="text-xl font-semibold tracking-[-0.01em] text-ink">Match</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <PlayerDetail p={mine} total={view.totalTests} me />
        <PlayerDetail p={theirs} total={view.totalTests} />
      </div>
      <SectionTitle>How it’s decided</SectionTitle>
      <ul className="list-disc space-y-1.5 pl-5 text-[15px] leading-7 text-ink/90 marker:text-azure/70">
        <li>
          The first submission to pass every test wins, ordered by submission time, not judging
          time.
        </li>
        <li>If the clock runs out, whoever passed the most tests wins; equal counts are a draw.</li>
        <li>
          Disconnected for longer than the grace period, you forfeit. A reload brings you straight
          back.
        </li>
        <li>Your opponent sees your progress, never your code.</li>
      </ul>
    </div>
  );
}
