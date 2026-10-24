import {
  normalizeRoomCode,
  ROOM_CODE_LENGTH,
  type Ack,
  type MatchMode,
  type RoomDifficulty,
  type RoomPlayer,
  type RoomView,
} from '@thegrave/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { getSocket } from '../../lib/socket';
import { useAuth } from '../../stores/auth';
import { useLobby } from '../../stores/lobby';
import { useRoom } from '../../stores/room';
import { CheckIcon, CopyIcon } from '../battle/icons';
import { btnPrimary, btnSecondary, focusRing } from '../ui';
import { LinkIcon, UsersIcon } from './icons';

type Emit = (...args: unknown[]) => void;
/** Emits a room event and resolves with its ack. */
const call = <T extends object = object>(event: string, ...args: unknown[]) =>
  new Promise<Ack<T>>((resolve) => (getSocket().emit as Emit)(event, ...args, resolve));

const DIFFICULTIES: { id: RoomDifficulty; label: string; tone: string }[] = [
  { id: 'AUTO', label: 'Auto', tone: 'text-ash-300' },
  { id: 'EASY', label: 'Easy', tone: 'text-emerald-400' },
  { id: 'MEDIUM', label: 'Medium', tone: 'text-orange-400' },
  { id: 'HARD', label: 'Hard', tone: 'text-red-400' },
];

const shell =
  'relative overflow-hidden rounded-2xl bg-gradient-to-b from-[#131313] to-[#0b0b0b] shadow-[0_24px_60px_-30px_rgb(0_0_0),inset_0_1px_0_rgb(255_255_255/0.05)]';

function CopyButton({ text, label, icon }: { text: string; label: string; icon: 'code' | 'link' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        })
      }
      className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-white/[0.05] px-3 text-xs font-medium text-ink transition-colors hover:bg-white/[0.09] ${focusRing}`}
    >
      {done ? (
        <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
      ) : icon === 'code' ? (
        <CopyIcon className="h-3.5 w-3.5" />
      ) : (
        <LinkIcon className="h-3.5 w-3.5" />
      )}
      {done ? 'Copied' : label}
    </button>
  );
}

function Seat({
  player,
  role,
  status,
  you,
}: {
  player: RoomPlayer | null;
  role: 'Host' | 'Guest';
  status?: { text: string; tone: string };
  you: boolean;
}) {
  return (
    <div
      className={`flex min-h-16 items-center gap-3 rounded-xl px-4 py-3 ${
        player
          ? 'bg-white/[0.04]'
          : 'bg-white/[0.02] outline-1 -outline-offset-1 outline-dashed outline-ash-700'
      }`}
    >
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold ${
          player ? 'bg-azure/15 text-azure' : 'bg-white/[0.03] text-ash-600'
        }`}
        aria-hidden
      >
        {player ? player.username[0]!.toUpperCase() : '?'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ash-400">
          {role}
          {you && ' · you'}
        </p>
        {player ? (
          <p className="truncate text-sm text-ink">
            {player.username} <span className="font-mono text-ash-400">{player.rating}</span>
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-ash-400">
            <span className="h-1.5 w-1.5 rounded-full bg-azure motion-safe:animate-pulse" />
            Waiting for a friend…
          </p>
        )}
      </div>
      {status && (
        <span className={`shrink-0 text-xs font-medium ${status.tone}`}>{status.text}</span>
      )}
    </div>
  );
}

/** Inside a room: the code to share, both seats, the host's settings and the start. */
function Room({ room }: { room: RoomView }) {
  const me = useAuth((s) => s.user?.id);
  const isHost = room.host.id === me;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invite = `${window.location.origin}/play?room=${room.code}`;

  const act = async (event: string, ...args: unknown[]) => {
    setBusy(true);
    setError(null);
    const res = await call(event, ...args);
    setBusy(false);
    if (!res.ok) setError(res.message);
  };

  return (
    <section aria-label="Private room" className={shell}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_45%_120%_at_0%_50%,rgb(92_184_255/0.12),transparent_70%)]"
      />
      <div className="relative grid gap-6 p-5 md:grid-cols-[auto_1fr] md:gap-10 md:p-6">
        {/* The code, big enough to read out loud. */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ash-400">
            Room code
          </p>
          <p
            className="mt-1 font-mono text-4xl font-semibold tracking-[0.25em] text-ink"
            data-testid="room-code"
          >
            {room.code}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton text={room.code} label="Copy code" icon="code" />
            <CopyButton text={invite} label="Copy invite link" icon="link" />
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <Seat player={room.host} role="Host" you={isHost} />
            <Seat
              player={room.guest}
              role="Guest"
              you={!isHost}
              status={
                room.guest
                  ? room.guestReady
                    ? { text: 'Ready', tone: 'text-emerald-400' }
                    : { text: 'Not ready', tone: 'text-ash-400' }
                  : undefined
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ash-400">
                Battle {!isHost && '(host picks)'}
              </p>
              <div
                className="mt-1.5 flex rounded-full bg-white/[0.05] p-1"
                role="group"
                aria-label="Room mode"
              >
                {(
                  [
                    ['DSA', 'DSA'],
                    ['PROGRAMMING', 'Programming'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => void act('room:update', { mode: id })}
                    disabled={!isHost || busy}
                    aria-pressed={room.mode === id}
                    className={`h-8 rounded-full px-3 text-xs font-medium transition-colors enabled:cursor-pointer disabled:cursor-default ${focusRing} ${
                      room.mode === id
                        ? 'bg-white/[0.1] text-azure'
                        : 'text-ash-400 enabled:hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ash-400">
                Difficulty {!isHost && '(host picks)'}
              </p>
              <div
                className="mt-1.5 flex rounded-full bg-white/[0.05] p-1"
                role="group"
                aria-label="Room difficulty"
              >
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => void act('room:update', { difficulty: d.id })}
                    disabled={!isHost || busy}
                    aria-pressed={room.difficulty === d.id}
                    className={`h-8 rounded-full px-3 text-xs font-medium transition-colors enabled:cursor-pointer disabled:cursor-default ${focusRing} ${
                      room.difficulty === d.id
                        ? `bg-white/[0.1] ${d.tone}`
                        : 'text-ash-400 enabled:hover:text-ink'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-ash-400">Friendly match · unrated</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {isHost ? (
              <button
                onClick={() => void act('room:start')}
                disabled={busy || !room.guest || !room.guestReady}
                className={`${btnPrimary} min-h-11 rounded-md px-6`}
              >
                Start battle
              </button>
            ) : (
              <button
                onClick={() => void act('room:update', { ready: !room.guestReady })}
                disabled={busy}
                className={`${room.guestReady ? btnSecondary : btnPrimary} min-h-11 rounded-md px-6`}
              >
                {room.guestReady ? 'Not ready' : 'Ready'}
              </button>
            )}
            {isHost && room.guest && (
              <button
                onClick={() => void act('room:update', { kick: true })}
                disabled={busy}
                className={`${btnSecondary} min-h-11 rounded-md`}
              >
                Remove guest
              </button>
            )}
            <button
              onClick={() => void act('room:leave')}
              disabled={busy}
              className={`${btnSecondary} min-h-11 rounded-md`}
            >
              {isHost ? 'Close room' : 'Leave room'}
            </button>
          </div>
          {isHost && room.guest && !room.guestReady && (
            <p className="text-xs text-ash-400">
              You can start once {room.guest.username} is ready.
            </p>
          )}
          {error && (
            <p className="text-sm text-orange-400" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Private rooms (decision.md D-065), next to ranked matchmaking: create a room and share its code or
 * link, or join a friend's. `?room=CODE` in the URL joins straight away, which is what invite links do.
 */
export function RoomPanel({ defaultMode = 'DSA' }: { defaultMode?: MatchMode }) {
  const room = useRoom((s) => s.room);
  const notice = useRoom((s) => s.notice);
  const connected = useLobby((s) => s.connected);
  const queued = useLobby((s) => s.status !== 'idle' && s.status !== 'confirmed');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useSearchParams();
  const invited = useRef(false);

  const join = async (raw: string) => {
    setBusy(true);
    setError(null);
    const res = await call<{ room: RoomView }>('room:join', { code: raw });
    setBusy(false);
    if (!res.ok) setError(res.message);
  };

  // Invite links: join once the socket is up, then drop the parameter so a reload doesn't retry.
  const invite = params.get('room');
  useEffect(() => {
    if (!invite || !connected || invited.current) return;
    invited.current = true;
    setCode(normalizeRoomCode(invite));
    void join(invite).finally(() =>
      setParams(
        (p) => {
          p.delete('room');
          return p;
        },
        { replace: true },
      ),
    );
  }, [invite, connected, setParams]);

  if (room) return <Room room={room} />;

  const create = async () => {
    setBusy(true);
    setError(null);
    const res = await call<{ room: RoomView }>('room:create', { mode: defaultMode });
    setBusy(false);
    if (!res.ok) setError(res.message);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (normalizeRoomCode(code).length === ROOM_CODE_LENGTH) void join(code);
  };
  const disabled = !connected || busy || queued;

  return (
    <section aria-label="Private room" className={shell}>
      <div className="relative flex flex-col gap-5 p-5 md:flex-row md:items-center md:gap-8 md:px-6">
        <div className="flex flex-1 items-center gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-azure/10 text-azure">
            <UsersIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">Private room</p>
            <p className="text-xs text-ash-400">
              Challenge a friend with a code to a{' '}
              {defaultMode === 'DSA' ? 'DSA problem' : 'debugging race'}. Friendly matches don’t
              change ratings.
            </p>
          </div>
        </div>
        <form onSubmit={submit} className="flex gap-2">
          <label className="sr-only" htmlFor="room-code">
            Room code
          </label>
          <input
            id="room-code"
            value={code}
            onChange={(e) => setCode(normalizeRoomCode(e.target.value).slice(0, ROOM_CODE_LENGTH))}
            placeholder="ENTER CODE"
            autoComplete="off"
            spellCheck={false}
            className={`h-11 w-36 rounded-md bg-white/[0.05] px-3 text-center font-mono text-sm uppercase tracking-[0.25em] text-ink placeholder:tracking-[0.15em] placeholder:text-ash-600 ${focusRing}`}
          />
          <button
            type="submit"
            disabled={disabled || normalizeRoomCode(code).length !== ROOM_CODE_LENGTH}
            className={`${btnSecondary} min-h-11 rounded-md`}
          >
            Join
          </button>
        </form>
        <button
          onClick={() => void create()}
          disabled={disabled}
          className={`${btnSecondary} min-h-11 rounded-md md:w-40`}
        >
          Create room
        </button>
      </div>
      {(error || notice || queued) && (
        <p className="relative px-5 pb-4 text-sm text-ash-300 md:px-6" role="status">
          {error ?? notice ?? 'Leave the ranked queue to use a private room.'}
        </p>
      )}
    </section>
  );
}
