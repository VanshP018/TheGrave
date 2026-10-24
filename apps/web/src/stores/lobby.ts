import type { MatchMode, Opponent } from '@thegrave/shared';
import { create } from 'zustand';

export type LobbyStatus = 'idle' | 'queued' | 'ready' | 'confirmed';

interface LobbyState {
  connected: boolean;
  status: LobbyStatus;
  joinedAt: number | null;
  /** Which queue the user is in (or was matched from); one at a time (decision.md D-067). */
  mode: MatchMode | null;
  /** Players waiting, per queue. */
  queued: Record<MatchMode, number>;
  match: { id: string; opponent: Opponent; expiresAt: number; accepted: string[] } | null;
  notice: string | null;
  set: (patch: Partial<Omit<LobbyState, 'set'>>) => void;
}

export const useLobby = create<LobbyState>((set) => ({
  connected: false,
  status: 'idle',
  joinedAt: null,
  mode: null,
  queued: { DSA: 0, PROGRAMMING: 0 },
  match: null,
  notice: null,
  set: (patch) => set(patch),
}));
