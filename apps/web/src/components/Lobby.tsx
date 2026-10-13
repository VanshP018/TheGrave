import type { Ack } from '@thegrave/shared';
import { useEffect, useState } from 'react';
import { disconnectSocket, getSocket } from '../lib/socket';
import { useAuth } from '../stores/auth';
import { useLobby } from '../stores/lobby';

/** Re-renders every `ms` so countdowns tick. */
function useNow(ms = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Wires socket events into the lobby store for as long as the lobby is mounted. */
function useMatchmakingSocket() {
  const set = useLobby((s) => s.set);
  const me = useAuth((s) => s.user?.id);

  useEffect(() => {
    const s = getSocket();
    s.on('connect', () => set({ connected: true }));
    s.on('disconnect', () => set({ connected: false }));
    s.on('queue:joined', ({ joinedAt }) => set({ status: 'queued', joinedAt, notice: null }));
    s.on('queue:left', ({ reason }) =>
      set({
        status: 'idle',
        joinedAt: null,
        notice: reason === 'expired' ? 'You were removed from the queue (connection lost).' : null,
      }),
    );
    s.on('queue:stats', ({ queued }) => set({ queued }));
    s.on('match:found', ({ matchId, opponent, expiresAt }) =>
      set({ status: 'ready', match: { id: matchId, opponent, expiresAt, accepted: [] } }),
    );
    s.on('match:accepted', ({ matchId, userId }) => {
      const m = useLobby.getState().match;
      if (m?.id === matchId)
        set({ match: { ...m, accepted: [...new Set([...m.accepted, userId])] } });
    });
    s.on('match:confirmed', ({ opponent }) =>
      set({
        status: 'confirmed',
        notice: `Match confirmed vs ${opponent.username}. Battles arrive in Phase 4.`,
      }),
    );
    s.on('match:cancelled', ({ reason, requeued }) =>
      set({
        status: requeued ? 'queued' : 'idle',
        match: null,
        notice: requeued
          ? 'Your opponent didn’t accept. Back in the queue, your place is kept.'
          : reason === 'timeout'
            ? 'You didn’t accept in time.'
            : 'Match declined.',
      }),
    );
    s.connect();
    return () => {
      s.removeAllListeners();
      disconnectSocket();
      set({ connected: false, status: 'idle', match: null });
    };
  }, [set, me]);
}

const emitAck = <T extends object>(fn: (ack: (r: Ack<T>) => void) => void) =>
  new Promise<Ack<T>>((resolve) => fn(resolve));

export function Lobby() {
  useMatchmakingSocket();
  const { connected, status, joinedAt, queued, match, notice, set } = useLobby();
  const me = useAuth((s) => s.user?.id);
  const now = useNow();
  const s = getSocket();

  const join = async () => {
    const res = await emitAck<{ joinedAt: number }>((ack) => s.emit('queue:join', ack));
    if (!res.ok) set({ notice: res.message });
  };
  const leave = () => emitAck((ack) => s.emit('queue:leave', ack));
  const respond = (accept: boolean) =>
    match &&
    emitAck((ack) => s.emit(accept ? 'match:accept' : 'match:decline', { matchId: match.id }, ack));

  const waited = joinedAt ? Math.max(0, Math.floor((now - joinedAt) / 1000)) : 0;
  const remaining = match ? Math.max(0, Math.ceil((match.expiresAt - now) / 1000)) : 0;
  const iAccepted = !!(me && match?.accepted.includes(me));

  return (
    <section className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <div className="flex items-center justify-between text-sm text-zinc-400">
        <span className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-zinc-600'}`}
          />
          {connected ? 'Connected' : 'Connecting…'}
        </span>
        <span>{queued} in queue</span>
      </div>

      {status === 'idle' || status === 'confirmed' ? (
        <button
          onClick={join}
          disabled={!connected}
          className="mt-6 w-full rounded-md bg-emerald-600 py-3 font-semibold hover:bg-emerald-500 disabled:opacity-50"
        >
          Find match
        </button>
      ) : status === 'queued' ? (
        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-zinc-300">
            Searching… <span className="font-mono text-zinc-400">{waited}s</span>
          </p>
          <button
            onClick={leave}
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      ) : (
        match && (
          <div className="mt-6 space-y-4" role="dialog" aria-label="Match found">
            <p className="text-lg">
              Match found: <span className="font-semibold">{match.opponent.username}</span>{' '}
              <span className="font-mono text-emerald-400">({match.opponent.rating})</span>
            </p>
            <p className="text-sm text-zinc-400">
              {iAccepted ? 'Waiting for your opponent…' : 'Accept to start.'}{' '}
              <span className="font-mono">{remaining}s</span>
            </p>
            {!iAccepted && (
              <div className="flex gap-3">
                <button
                  onClick={() => respond(true)}
                  className="flex-1 rounded-md bg-emerald-600 py-2 font-semibold hover:bg-emerald-500"
                >
                  Accept
                </button>
                <button
                  onClick={() => respond(false)}
                  className="flex-1 rounded-md border border-zinc-700 py-2 hover:bg-zinc-800"
                >
                  Decline
                </button>
              </div>
            )}
          </div>
        )
      )}

      {notice && <p className="mt-4 text-sm text-zinc-400">{notice}</p>}
    </section>
  );
}
