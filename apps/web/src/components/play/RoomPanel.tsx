import {
  normalizeRoomCode,
  ROOM_CODE_LENGTH,
  type Ack,
  type MatchMode,
  type RoomDifficulty,
  type RoomPlayer,
  type RoomView,
} from '@thegrave/shared';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { getSocket } from '../../lib/socket';
import { useAuth } from '../../stores/auth';
import { useLobby } from '../../stores/lobby';
import { useRoom } from '../../stores/room';
import { Avatar } from '../Avatar';
import { CheckIcon, CopyIcon } from '../battle/icons';
import { btnPrimary, btnSecondary, focusRing } from '../ui';
import { ModeCard } from './ModeCard';
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
      className={`inline-flex h-7 cursor-pointer items-center gap-2 rounded-md bg-white/[0.05] px-3 text-xs font-medium text-ink transition-colors hover:bg-white/[0.09] ${focusRing}`}
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

/** A seat as just an avatar: ringed azure when ready, dashed and empty while waiting for a friend. */
function Seat({
  player,
  role,
  ready,
  you,
  green,
}: {
  player: RoomPlayer | null;
  role: 'Host' | 'Guest';
  ready?: boolean;
  you: boolean;
  green: boolean;
}) {
  const label = player
    ? `${role}: ${player.username}${you ? ' (you)' : ''}${ready ? ', ready' : ''}`
    : `${role}: waiting for a friend`;
  return (
    <span className="relative" title={label} role="img" aria-label={label}>
      {player ? (
        <Avatar
          username={player.username}
          url={player.avatarUrl}
          size={44}
          glow={you}
          tone={green ? 'emerald' : 'azure'}
        />
      ) : (
        <span className="grid h-11 w-11 place-items-center rounded-full bg-black/20 text-ash-400 outline-1 -outline-offset-1 outline-dashed outline-white/30 motion-safe:animate-pulse">
          ?
        </span>
      )}
      {ready && (
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-emerald-400 text-[#0a0a0a] ring-2 ring-[#10161c]"
        >
          <CheckIcon className="h-2.5 w-2.5" />
        </span>
      )}
    </span>
  );
}

/** The primary action, in the card's own accent: azure for DSA rooms, emerald for debugging rooms. */
const primary = (green: boolean) =>
  green ? '!bg-emerald-400 !text-[#06140e] shadow-[0_0_32px_-10px_rgb(52_211_153/0.6)]' : '';

const pick =
  'h-8 cursor-pointer rounded-md bg-black/25 px-2 text-xs text-ink ring-1 ring-inset ring-white/15 disabled:cursor-default disabled:opacity-60';

/** Inside a room: the code to share, both avatars, the host's settings and the start, all in one card. */
function Room({ room }: { room: RoomView }) {
  const green = room.mode === 'PROGRAMMING';
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
    <ModeCard
      tone={green ? 'forest' : 'graphite'}
      art={green ? 'pair' : 'rooms'}
      pill={
        <>
          <UsersIcon className="h-4 w-4" />
          {green ? 'Debugging room' : 'DSA room'}
        </>
      }
      tag="Friendly · unrated"
      title="Room"
      subtitle=""
      body={
        <div aria-label="Private room" role="region" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p
                className="font-mono text-3xl font-semibold leading-none tracking-[0.2em] text-ink"
                data-testid="room-code"
              >
                {room.code}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <CopyButton text={room.code} label="Copy code" icon="code" />
                <CopyButton text={invite} label="Copy link" icon="link" />
              </div>
            </div>
            <div className="flex shrink-0 -space-x-2">
              <Seat player={room.host} role="Host" you={isHost} green={green} />
              <Seat
                player={room.guest}
                role="Guest"
                you={!isHost}
                ready={room.guestReady}
                green={green}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Room difficulty"
              value={room.difficulty}
              onChange={(e) => void act('room:update', { difficulty: e.target.value })}
              disabled={!isHost || busy}
              className={`${pick} ${focusRing}`}
            >
              {DIFFICULTIES.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
            {!isHost && <span className="text-xs text-ash-400">Host picks</span>}
          </div>

          <div className="flex flex-wrap gap-2">
            {isHost ? (
              <button
                onClick={() => void act('room:start')}
                disabled={busy || !room.guest || !room.guestReady}
                className={`${btnPrimary} min-h-10 rounded-md px-5 ${primary(green)}`}
              >
                Start battle
              </button>
            ) : (
              <button
                onClick={() => void act('room:update', { ready: !room.guestReady })}
                disabled={busy}
                className={`${room.guestReady ? btnSecondary : `${btnPrimary} ${primary(green)}`} min-h-10 rounded-md px-5`}
              >
                {room.guestReady ? 'Not ready' : 'Ready'}
              </button>
            )}
            {isHost && room.guest && (
              <button
                onClick={() => void act('room:update', { kick: true })}
                disabled={busy}
                className={`${btnSecondary} min-h-10 rounded-md`}
              >
                Remove guest
              </button>
            )}
            <button
              onClick={() => void act('room:leave')}
              disabled={busy}
              className={`${btnSecondary} min-h-10 rounded-md`}
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
      }
    />
  );
}

/**
 * Private rooms (decision.md D-065), next to ranked matchmaking: create a room and share its code or
 * link, or join a friend's. `?room=CODE` in the URL joins straight away, which is what invite links do.
 */
export function RoomPanel({
  defaultMode = 'DSA',
  lead,
}: {
  defaultMode?: MatchMode;
  /** The ranked "Find match" card: it sits beside Create room (and stays, disabled, in a room). */
  lead?: ReactNode;
}) {
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

  if (room)
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {lead}
        <Room room={room} />
      </div>
    );

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
    <div className="grid gap-4 md:grid-cols-2">
      {lead}
      <ModeCard
        tone={defaultMode === 'DSA' ? 'graphite' : 'forest'}
        art={defaultMode === 'DSA' ? 'rooms' : 'pair'}
        pill={
          <>
            <UsersIcon className="h-4 w-4" />
            Friends
          </>
        }
        tag="Friendly · unrated"
        title="Create room"
        subtitle={`Challenge a friend to a ${defaultMode === 'DSA' ? 'DSA problem' : 'debugging race'}`}
        onClick={() => void create()}
        disabled={disabled}
        footer={
          <form onSubmit={submit} className="flex max-w-sm gap-2">
            <label className="sr-only" htmlFor="room-code">
              Room code
            </label>
            <input
              id="room-code"
              value={code}
              onChange={(e) =>
                setCode(normalizeRoomCode(e.target.value).slice(0, ROOM_CODE_LENGTH))
              }
              placeholder="HAVE A CODE?"
              autoComplete="off"
              spellCheck={false}
              className={`h-10 min-w-0 flex-1 rounded-md bg-black/30 px-3 text-center font-mono text-sm uppercase tracking-[0.25em] text-ink ring-1 ring-inset ring-white/15 placeholder:tracking-[0.15em] placeholder:text-ash-400 ${focusRing}`}
            />
            <button
              type="submit"
              disabled={disabled || normalizeRoomCode(code).length !== ROOM_CODE_LENGTH}
              className={`${btnSecondary} min-h-10 rounded-md bg-black/20`}
            >
              Join
            </button>
          </form>
        }
      />
      {(error || notice || queued) && (
        <p className="text-sm text-ash-300 md:col-span-2" role="status">
          {error ?? notice ?? 'Leave the ranked queue to use a private room.'}
        </p>
      )}
    </div>
  );
}
