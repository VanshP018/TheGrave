import type { BattleView, PlayerProgress } from '@thegrave/shared';
import { useState } from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { useBattleUi } from '../../stores/battle';
import { focusRing } from '../ui';
import { FlagIcon, HandshakeIcon } from './icons';
import { PlayerChip } from './Players';

const iconBtn = `relative grid h-8 w-8 cursor-pointer place-items-center rounded-full text-ash-400 transition-colors hover:bg-white/[0.07] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;

/**
 * Centre of the battle bar (decision.md D-068): offer-draw and quit beside your avatar, then the opponent.
 * An incoming draw offer drops down underneath with Accept / Decline.
 */
export function BattleHud(props: {
  v: BattleView;
  mine: PlayerProgress;
  theirs: PlayerProgress;
  me: string | undefined;
  now: number;
  live: boolean;
}) {
  const { v, mine, theirs, me, now, live } = props;
  const declined = useBattleUi((s) => s.drawDeclined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = now >= v.startsAt;
  const myOffer = v.drawOfferedBy === me;
  const theirOffer = !!v.drawOfferedBy && !myOffer;

  const act = async (path: 'draw' | 'resign', action?: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/matches/${v.id}/${path}`, { method: 'POST', json: action ? { action } : {} });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reach the server');
      setTimeout(() => setError(null), 4000);
    } finally {
      setBusy(false);
    }
  };
  const quit = () => {
    if (window.confirm('Quit this battle? Your opponent wins.')) void act('resign');
  };

  return (
    <div className="relative order-last flex w-full items-center justify-center gap-3 lg:order-none lg:w-auto">
      <div className="flex items-center gap-0.5" role="group" aria-label="Battle actions">
        <button
          onClick={() => void act('draw', myOffer ? 'withdraw' : 'offer')}
          disabled={!live || !started || busy || theirOffer}
          aria-label={myOffer ? 'Withdraw draw offer' : 'Offer a draw'}
          title={myOffer ? 'Draw offered: click to withdraw' : 'Offer a draw'}
          className={`${iconBtn} ${myOffer ? 'bg-azure/10 text-azure' : ''}`}
        >
          <HandshakeIcon className="h-4 w-4" />
          {myOffer && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-azure motion-safe:animate-pulse" />
          )}
        </button>
        <button
          onClick={quit}
          disabled={!live || busy}
          aria-label="Quit the battle"
          title="Quit (your opponent wins)"
          className={`${iconBtn} hover:!text-red-400`}
        >
          <FlagIcon className="h-4 w-4" />
        </button>
      </div>
      <PlayerChip p={mine} total={v.totalTests} me now={now} />
      <span className="text-[11px] font-semibold uppercase tracking-widest text-ash-600">vs</span>
      <PlayerChip p={theirs} total={v.totalTests} now={now} testId="opponent-progress" />

      {(theirOffer || declined || error) && live && (
        <div
          className="absolute left-1/2 top-full z-30 mt-3 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full bg-[#141414] py-1.5 pl-4 pr-1.5 text-sm text-ink shadow-[0_12px_40px_-8px_rgb(0_0_0/0.9),inset_0_1px_0_rgb(255_255_255/0.06)]"
          role={theirOffer ? 'alertdialog' : 'status'}
          aria-label={theirOffer ? 'Draw offered' : undefined}
        >
          {theirOffer ? (
            <>
              <HandshakeIcon className="h-4 w-4 text-azure" />
              Your opponent offers a draw
              <button
                onClick={() => void act('draw', 'accept')}
                disabled={busy}
                className={`h-8 cursor-pointer rounded-full bg-azure px-4 text-xs font-semibold text-hero-bg hover:brightness-110 ${focusRing}`}
              >
                Accept draw
              </button>
              <button
                onClick={() => void act('draw', 'decline')}
                disabled={busy}
                className={`h-8 cursor-pointer rounded-full bg-white/[0.07] px-4 text-xs font-medium text-ink hover:bg-white/[0.12] ${focusRing}`}
              >
                Decline
              </button>
            </>
          ) : (
            <span className="pr-3 text-ash-300">{error ?? 'Your draw offer was declined.'}</span>
          )}
        </div>
      )}
    </div>
  );
}
