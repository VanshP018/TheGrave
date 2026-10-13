import type { Opponent } from '@thegrave/shared';
import { create } from 'zustand';

export type LobbyStatus = 'idle' | 'queued' | 'ready' | 'confirmed';

interface LobbyState {
  connected: boolean;
  status: LobbyStatus;
  joinedAt: number | null;
  queued: number;
  match: { id: string; opponent: Opponent; expiresAt: number; accepted: string[] } | null;
  notice: string | null;
  set: (patch: Partial<Omit<LobbyState, 'set'>>) => void;
}

export const useLobby = create<LobbyState>((set) => ({
  connected: false,
  status: 'idle',
  joinedAt: null,
  queued: 0,
  match: null,
  notice: null,
  set: (patch) => set(patch),
}));
