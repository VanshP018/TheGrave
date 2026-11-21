import { LANGUAGES, type Ack, type Language, type MatchMode } from '@thegrave/shared';
import { serverNow } from '../lib/clock';
import { getSocket } from '../lib/socket';
import { useNow } from '../lib/useNow';
import { useAuth } from '../stores/auth';
import { useLobby } from '../stores/lobby';
import { useRoom } from '../stores/room';
import { LANGUAGE_LABEL } from './battle/ProblemPanel';
import { ChevronIcon } from './battle/icons';
import { Dot, ModeCard } from './play/ModeCard';
import { btnSecondary, focusRing } from './ui';

const emitAck = <T extends object>(fn: (ack: (r: Ack<T>) => void) => void) =>
  new Promise<Ack<T>>((resolve) => fn(resolve));

/** Queue notices (e.g. why a search could not start). The ready check itself lives in {@link FindMatchCard}. */
export function Lobby() {
  const notice = useLobby((s) => s.notice);
  if (!notice) return null;
  return (
    <p className="mb-4 rounded-xl bg-white/[0.04] px-5 py-3 text-sm text-ash-300" role="status">
      {notice}
    </p>
  );
}

/**
 * The big "Find match" card for a mode's ranked queue. It carries the connection state, the language
 * (DSA) or format (programming), and turns into the searching timer with a cancel while queued.
 */
export function FindMatchCard({
  mode = 'DSA',
  language,
  onLanguage,
}: {
  mode?: MatchMode;
  language?: Language;
  onLanguage?: (l: Language) => void;
}) {
  const { connected, status, mode: queueMode, joinedAt, match, set } = useLobby();
  const me = useAuth((s) => s.user?.id);
  const inRoom = useRoom((s) => !!s.room);
  useNow();
  const mine = queueMode === mode;
  const searching = status === 'queued' && mine;
  const taken = status !== 'idle' && status !== 'confirmed';
  const waited = joinedAt ? Math.max(0, Math.floor((serverNow() - joinedAt) / 1000)) : 0;

  const join = async () => {
    const res = await emitAck<{ joinedAt: number }>((ack) =>
      getSocket().emit('queue:join', { mode }, ack),
    );
    if (!res.ok) set({ notice: res.message });
  };
  const respond = (accept: boolean) =>
    match &&
    emitAck((ack) =>
      getSocket().emit(accept ? 'match:accept' : 'match:decline', { matchId: match.id }, ack),
    );
  const found = mine && status !== 'idle' && status !== 'confirmed' && status !== 'queued' && match;
  const remaining = match ? Math.max(0, Math.ceil((match.expiresAt - serverNow()) / 1000)) : 0;
  const iAccepted = !!(me && match?.accepted.includes(me));
  const leave = () => emitAck((ack) => getSocket().emit('queue:leave', ack));

  return (
    <ModeCard
      tone={mode === 'DSA' ? 'azure' : 'emerald'}
      art={mode === 'DSA' ? 'arena' : 'code'}
      pill={
        found ? (
          <>
            <Dot ping />
            Match found
          </>
        ) : (
          <>
            <Dot on={connected} ping={connected} />
            {connected ? 'Online' : 'Connecting…'}
          </>
        )
      }
      body={
        found ? (
          <div role="dialog" aria-label="Match found">
            <p className="text-sm text-white/75">Your opponent</p>
            <p className="mt-1 text-[clamp(1.6rem,3.5vw,2.2rem)] font-bold leading-none tracking-tight text-white">
              {found.opponent.username}{' '}
              <span className="font-mono text-lg font-medium text-white/75">
                {found.opponent.rating}
              </span>
            </p>
            <p className="mt-2 text-sm text-white/75">
              {iAccepted ? 'Waiting for your opponent…' : 'Accept to start.'}{' '}
              <span className="font-mono tabular-nums">{remaining}s</span>
            </p>
            {/* The 10 s window, drawn down as a bar. */}
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-black/30">
              <div
                className="h-full bg-white transition-[width] duration-1000 ease-linear"
                style={{ width: `${Math.min(100, (remaining / 10) * 100)}%` }}
              />
            </div>
            {!iAccepted && (
              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => respond(true)}
                  className={`inline-flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-md bg-white px-5 text-sm font-semibold text-[#0a0a0a] transition hover:brightness-95 active:scale-[0.97] ${focusRing}`}
                >
                  Accept
                </button>
                <button
                  onClick={() => respond(false)}
                  className={`${btnSecondary} flex-1 rounded-md border-white/30 bg-black/20`}
                >
                  Decline
                </button>
              </div>
            )}
          </div>
        ) : undefined
      }
      tag={mode === 'DSA' ? 'Ranked 1v1' : 'Ranked debugging'}
      title="Find match"
      subtitle={
        searching
          ? `Searching for an opponent… ${waited}s`
          : taken && !mine
            ? `You’re in the ${queueMode === 'DSA' ? 'DSA' : 'Programming'} queue`
            : inRoom
              ? 'Leave your private room to queue'
              : mode === 'DSA'
                ? 'Rated duel · first accepted solution wins'
                : 'Same codebase · first to fix it wins'
      }
      onClick={join}
      disabled={!connected || inRoom || taken}
      hint={inRoom ? 'Leave your private room to queue for ranked' : undefined}
      footer={
        searching ? (
          <button
            onClick={leave}
            className={`${btnSecondary} rounded-md border-white/30 bg-black/20`}
          >
            Cancel search
          </button>
        ) : mode === 'DSA' && onLanguage ? (
          <label className="relative inline-flex items-center gap-2 text-xs text-white/75">
            Language
            <span className="relative inline-flex">
              <select
                value={language}
                onChange={(e) => onLanguage(e.target.value as Language)}
                disabled={taken}
                aria-label="Preferred language"
                className={`cursor-pointer appearance-none rounded-md bg-black/25 py-1.5 pl-3 pr-8 text-sm text-white ring-1 ring-inset ring-white/20 transition-colors hover:bg-black/35 disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
              >
                {LANGUAGES.map((l) => (
                  <option key={l} value={l} className="text-black">
                    {LANGUAGE_LABEL[l]}
                  </option>
                ))}
              </select>
              <ChevronIcon className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/70" />
            </span>
          </label>
        ) : undefined
      }
    />
  );
}
