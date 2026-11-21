import { useQueryClient } from '@tanstack/react-query';
import type { BattleView } from '@thegrave/shared';
import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { syncClock } from '../lib/clock';
import { disconnectSocket, getSocket } from '../lib/socket';
import { useLobby } from '../stores/lobby';
import { useBattleUi } from '../stores/battle';
import { useRoom } from '../stores/room';
import { useAuth } from '../stores/auth';

/**
 * One socket for the whole signed-in app (it must survive navigating lobby → battle).
 * Matchmaking events feed the lobby store; battle events patch or refetch the battle query.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    const set = useLobby.getState().set;
    const s = getSocket();
    const battleKey = (id: string) => ['match', id];
    const refetch = (id: string) => void qc.invalidateQueries({ queryKey: battleKey(id) });

    s.on('connect', () => {
      set({ connected: true });
      void syncClock(s);
    });
    s.on('disconnect', () => set({ connected: false }));

    s.on('queue:joined', ({ joinedAt, mode }) =>
      set({ status: 'queued', joinedAt, mode, notice: null }),
    );
    s.on('queue:left', ({ reason }) =>
      set({
        status: 'idle',
        joinedAt: null,
        mode: null,
        notice: reason === 'expired' ? 'You were removed from the queue (connection lost).' : null,
      }),
    );
    s.on('match:found', ({ matchId, opponent, expiresAt, mode }) =>
      set({ status: 'ready', mode, match: { id: matchId, opponent, expiresAt, accepted: [] } }),
    );
    s.on('match:accepted', ({ matchId, userId }) => {
      const m = useLobby.getState().match;
      if (m?.id === matchId)
        set({ match: { ...m, accepted: [...new Set([...m.accepted, userId])] } });
    });
    s.on('match:confirmed', () =>
      set({ status: 'confirmed', notice: 'Match confirmed. Starting…' }),
    );
    s.on('match:cancelled', ({ reason, requeued }) =>
      set({
        status: requeued ? 'queued' : 'idle',
        mode: requeued ? useLobby.getState().mode : null,
        match: null,
        notice: requeued
          ? 'Your opponent didn’t accept. Back in the queue, your place is kept.'
          : reason === 'timeout'
            ? 'You didn’t accept in time.'
            : 'Match declined.',
      }),
    );

    const setRoom = useRoom.getState().set;
    s.on('room:updated', (room) => setRoom({ room, notice: null }));
    s.on('room:closed', ({ reason }) =>
      setRoom({
        room: null,
        notice:
          reason === 'host-left'
            ? 'The host closed the room.'
            : reason === 'kicked'
              ? 'The host removed you from the room.'
              : reason === 'start-failed'
                ? 'The battle could not start. Try again.'
                : null,
      }),
    );

    // Also sent on reconnect while a battle is live, so a reload anywhere lands back in the battle.
    s.on('battle:created', ({ matchId }) => {
      set({ status: 'idle', mode: null, match: null, notice: null });
      setRoom({ room: null, notice: null });
      if (!window.location.pathname.startsWith(`/battle/${matchId}`))
        navigate(`/battle/${matchId}`);
    });
    s.on('battle:started', ({ matchId }) => refetch(matchId));
    s.on('battle:finished', ({ matchId }) => {
      refetch(matchId);
      // Ratings just changed: anything showing them is stale.
      for (const key of ['me', 'profile', 'leaderboard'])
        void qc.invalidateQueries({ queryKey: [key] });
    });
    s.on('submission:judged', ({ matchId }) => refetch(matchId));
    s.on('battle:draw', ({ matchId, offeredBy, declinedBy }) => {
      qc.setQueryData<BattleView>(
        battleKey(matchId),
        (v) => v && { ...v, drawOfferedBy: offeredBy },
      );
      if (declinedBy && declinedBy !== useAuth.getState().user?.id) {
        useBattleUi.getState().set({ drawDeclined: true });
        setTimeout(() => useBattleUi.getState().set({ drawDeclined: false }), 4000);
      }
    });
    s.on('battle:progress', ({ matchId, player }) =>
      qc.setQueryData<BattleView>(
        battleKey(matchId),
        (v) =>
          v && { ...v, players: v.players.map((p) => (p.userId === player.userId ? player : p)) },
      ),
    );

    s.connect();
    return () => {
      s.removeAllListeners();
      disconnectSocket();
      set({ connected: false, status: 'idle', match: null });
      useRoom.getState().set({ room: null, notice: null });
    };
  }, [navigate, qc]);

  return <>{children}</>;
}
