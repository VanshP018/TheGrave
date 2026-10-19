import type { BattleView, PlayerProgress } from '@thegrave/shared';
import { clock } from './format';
import { SectionTitle } from './Statement';

function Presence({ p, now }: { p: PlayerProgress; now: number }) {
  return p.connected ? (
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" title="Connected" />
  ) : (
    <span className="shrink-0 text-[11px] font-medium text-orange-400">
      away {p.graceEndsAt ? clock(p.graceEndsAt - now) : ''}
    </span>
  );
}

/** Compact progress for the top bar: name and presence over a thin bar with tests passed. */
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
      className={`flex w-40 flex-col justify-center gap-1 rounded-md border px-3 py-1 sm:w-48 ${
        me ? 'border-azure/30 bg-azure/[0.04]' : 'border-ash-700 bg-ash-900'
      }`}
      data-testid={testId}
      title={`${p.attempts} ${p.attempts === 1 ? 'attempt' : 'attempts'}${p.pending ? ', judging' : ''}`}
    >
      <div className="flex items-center justify-between gap-2 text-xs leading-4">
        <span className="truncate font-medium text-ink">
          <span className="text-ash-400">{me ? 'You' : 'Opp'} · </span>
          {p.username}
        </span>
        <Presence p={p} now={now} />
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-ash-700">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${me ? 'bg-azure' : 'bg-ash-300'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span
          className="shrink-0 font-mono text-[11px] leading-4 tabular-nums text-ash-300"
          data-testid={testId && `${testId}-passed`}
        >
          {p.bestPassed}/{total ?? '?'} tests
        </span>
      </div>
    </div>
  );
}

function PlayerDetail({ p, total, me }: { p: PlayerProgress; total: number | null; me?: boolean }) {
  const pct = total ? Math.round((p.bestPassed / total) * 100) : 0;
  return (
    <div className={`rounded-md border p-4 ${me ? 'border-azure/30' : 'border-ash-700'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate font-semibold text-ink">{p.username}</p>
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
