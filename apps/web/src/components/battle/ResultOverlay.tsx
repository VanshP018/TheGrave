import type { MatchResult, PlayerProgress } from '@thegrave/shared';
import { Link } from 'react-router';
import { btnPrimary } from '../ui';

const REASON: Record<MatchResult['endReason'], string> = {
  SOLVED: 'first to solve every test',
  TIMEOUT: 'decided on tests passed when time ran out',
  FORFEIT: 'opponent disconnected',
  ABANDONED: 'both players disconnected',
};

export function ResultOverlay({
  result,
  me,
  opponent,
  rated = true,
}: {
  result: MatchResult;
  me?: string;
  opponent: PlayerProgress;
  /** False for private-room matches (decision.md D-065). */
  rated?: boolean;
}) {
  const headline =
    result.status === 'ABORTED'
      ? 'Match aborted'
      : result.winnerId === null
        ? 'Draw'
        : result.winnerId === me
          ? 'You won!'
          : 'You lost';
  const won = result.status !== 'ABORTED' && result.winnerId !== null && result.winnerId === me;
  const reason =
    result.endReason === 'FORFEIT' && result.winnerId !== me
      ? 'you were disconnected too long'
      : REASON[result.endReason];
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-label="Match result"
    >
      <div
        className={`relative w-full max-w-sm overflow-hidden rounded-xl border bg-ash-900 p-8 text-center ${
          won ? 'border-azure/50 shadow-[0_0_80px_-20px_rgb(92_184_255/0.5)]' : 'border-ash-700'
        }`}
      >
        {won && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,rgb(92_184_255/0.18),transparent_70%)]"
          />
        )}
        <p
          className={`relative text-4xl font-semibold tracking-[-0.03em] ${
            won
              ? 'bg-gradient-to-br from-azure-light via-azure to-azure-deep bg-clip-text text-transparent'
              : 'text-ink'
          }`}
          data-testid="battle-result"
        >
          {headline}
        </p>
        <p className="relative mt-2 text-sm text-ash-300" data-testid="battle-result-reason">
          vs {opponent.username}: {reason}
        </p>
        {(() => {
          const mine = result.ratingChanges?.find((c) => c.userId === me);
          return mine ? (
            <p className="relative mt-5 font-mono text-lg" data-testid="rating-change">
              {mine.before} → <span className="font-semibold text-ink">{mine.after}</span>{' '}
              <span className={mine.delta > 0 ? 'text-azure' : 'text-ash-300'}>
                ({mine.delta > 0 ? '+' : ''}
                {mine.delta})
              </span>
            </p>
          ) : !rated ? (
            <p className="relative mt-5 text-sm text-ash-400">
              Friendly match: ratings are unchanged.
            </p>
          ) : result.status === 'ABORTED' ? (
            <p className="relative mt-5 text-sm text-ash-400">Unrated: ratings are unchanged.</p>
          ) : null;
        })()}
        <Link to="/play" className={`${btnPrimary} relative mt-7`}>
          Back to lobby
        </Link>
      </div>
    </div>
  );
}
