import { LANGUAGES, type Ack, type Language, type MatchMode } from '@thegrave/shared';
import type { ReactNode } from 'react';
import { serverNow } from '../lib/clock';
import { getSocket } from '../lib/socket';
import { useNow } from '../lib/useNow';
import { useAuth } from '../stores/auth';
import { useLobby } from '../stores/lobby';
import { useRoom } from '../stores/room';
import { LANGUAGE_LABEL } from './battle/ProblemPanel';
import { ChevronIcon } from './battle/icons';
import { BoltIcon } from './play/icons';
import { BotBadge, btnPrimary, btnSecondary, focusRing } from './ui';

const emitAck = <T extends object>(fn: (ack: (r: Ack<T>) => void) => void) =>
  new Promise<Ack<T>>((resolve) => fn(resolve));

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ash-400">{label}</p>
      <div className="mt-1 text-sm text-ink">{children}</div>
    </div>
  );
}

/**
 * Matchmaking bar for one mode's queue (decision.md D-064, D-067). One row: mode, editor language (or the
 * format, for programming), queue
 * status and the action. The ready check expands it in place. Socket events are wired by RealtimeProvider.
 */
export function Lobby({
  mode = 'DSA',
  language,
  onLanguage,
}: {
  mode?: MatchMode;
  language?: Language;
  onLanguage?: (l: Language) => void;
}) {
  const lobby = useLobby();
  const { connected, joinedAt, notice, set } = lobby;
  // Busy in the other mode's queue or ready check: this bar shows that instead of its own controls.
  const elsewhere = lobby.status !== 'idle' && lobby.status !== 'confirmed' && lobby.mode !== mode;
  const status = elsewhere ? 'idle' : lobby.status;
  const match = elsewhere ? null : lobby.match;
  const me = useAuth((s) => s.user?.id);
  const inRoom = useRoom((s) => !!s.room);
  useNow();
  const now = serverNow();
  const s = getSocket();

  const join = async () => {
    const res = await emitAck<{ joinedAt: number }>((ack) => s.emit('queue:join', { mode }, ack));
    if (!res.ok) set({ notice: res.message });
  };
  const leave = () => emitAck((ack) => s.emit('queue:leave', ack));
  const respond = (accept: boolean) =>
    match &&
    emitAck((ack) => s.emit(accept ? 'match:accept' : 'match:decline', { matchId: match.id }, ack));

  const waited = joinedAt ? Math.max(0, Math.floor((now - joinedAt) / 1000)) : 0;
  const remaining = match ? Math.max(0, Math.ceil((match.expiresAt - now) / 1000)) : 0;
  const iAccepted = !!(me && match?.accepted.includes(me));
  const idle = status === 'idle' || status === 'confirmed';
  const found = !idle && status !== 'queued' && match;

  return (
    <section
      aria-label="Matchmaking"
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-b from-[#131313] to-[#0b0b0b] shadow-[0_24px_60px_-30px_rgb(0_0_0),inset_0_1px_0_rgb(255_255_255/0.05)] transition-shadow duration-500 ${
        found ? 'shadow-[0_0_0_1px_rgb(92_184_255/0.4),0_24px_60px_-30px_rgb(92_184_255/0.5)]' : ''
      }`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_40%_120%_at_100%_50%,rgb(92_184_255/0.10),transparent_70%)]"
      />
      <div className="relative flex flex-col gap-5 p-5 md:flex-row md:items-center md:gap-8 md:px-6">
        <div className="grid flex-1 grid-cols-2 gap-5 sm:grid-cols-3">
          <Field label="Mode">
            <span className="inline-flex items-center gap-1.5">
              <BoltIcon className="h-3.5 w-3.5 text-azure" />
              {mode === 'DSA' ? 'Ranked 1v1' : 'Ranked debugging'}
            </span>
          </Field>
          {mode === 'PROGRAMMING' ? (
            <Field label="Format">
              <span className="text-ink">Same codebase, first to fix it</span>
            </Field>
          ) : (
            <Field label="Language">
              <label className="relative inline-flex">
                <span className="sr-only">Preferred language</span>
                <select
                  value={language}
                  onChange={(e) => onLanguage?.(e.target.value as Language)}
                  disabled={!idle}
                  className={`cursor-pointer appearance-none rounded-md bg-white/[0.05] py-1 pl-2.5 pr-7 text-sm text-ink transition-colors hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABEL[l]}
                    </option>
                  ))}
                </select>
                <ChevronIcon className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ash-400" />
              </label>
            </Field>
          )}
          <Field label="Server">
            <span className="inline-flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-ash-600'}`}
              />
              {connected ? 'Connected' : 'Connecting…'}
            </span>
          </Field>
        </div>

        <div className="md:w-64">
          {idle ? (
            elsewhere ? (
              <p className="rounded-md bg-white/[0.04] px-4 py-3 text-sm text-ash-300">
                You’re in the {lobby.mode === 'DSA' ? 'DSA' : 'Programming'} queue.
              </p>
            ) : (
              <button
                onClick={join}
                disabled={!connected || inRoom}
                title={inRoom ? 'Leave your private room to queue for ranked' : undefined}
                className={`${btnPrimary} min-h-12 w-full rounded-md text-base`}
              >
                Find match
              </button>
            )
          ) : status === 'queued' ? (
            <div className="flex items-center justify-between gap-4 rounded-md bg-azure/[0.08] py-1.5 pl-4 pr-1.5">
              <p className="flex items-center gap-3 text-sm text-ink">
                {/* A ping, not a spinner: it says "listening" rather than "loading". Off under reduced motion. */}
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-azure opacity-60 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-azure" />
                </span>
                Searching… <span className="font-mono tabular-nums text-ash-300">{waited}s</span>
              </p>
              <button onClick={leave} className={`${btnSecondary} rounded-md`}>
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {found && (
        <div
          className="relative flex flex-col gap-4 bg-azure/[0.05] px-5 py-5 md:flex-row md:items-center md:px-6"
          role="dialog"
          aria-label="Match found"
        >
          <div className="flex-1">
            <p className="text-lg text-ink">
              Match found: <span className="font-semibold">{match.opponent.username}</span>{' '}
              {match.opponent.bot && <BotBadge className="mr-1" />}
              <span className="font-mono text-azure">({match.opponent.rating})</span>
            </p>
            <p className="mt-0.5 text-sm text-ash-300">
              {iAccepted ? 'Waiting for your opponent…' : 'Accept to start.'}{' '}
              <span className="font-mono tabular-nums">{remaining}s</span>
            </p>
            {/* The 10 s window, drawn down as a blue bar. */}
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-ash-700">
              <div
                className="h-full bg-azure transition-[width] duration-1000 ease-linear"
                style={{ width: `${Math.min(100, (remaining / 10) * 100)}%` }}
              />
            </div>
          </div>
          {!iAccepted && (
            <div className="flex gap-3 md:w-64">
              <button onClick={() => respond(true)} className={`${btnPrimary} flex-1 rounded-md`}>
                Accept
              </button>
              <button
                onClick={() => respond(false)}
                className={`${btnSecondary} flex-1 rounded-md`}
              >
                Decline
              </button>
            </div>
          )}
        </div>
      )}

      {notice && <p className="relative px-5 pb-4 text-sm text-ash-300 md:px-6">{notice}</p>}
    </section>
  );
}
