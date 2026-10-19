import type { RoomView } from '@thegrave/shared';
import { create } from 'zustand';

interface RoomState {
  /** The private room this user is in (decision.md D-065), kept current by `room:updated`. */
  room: RoomView | null;
  notice: string | null;
  set: (patch: Partial<Omit<RoomState, 'set'>>) => void;
}

export const useRoom = create<RoomState>((set) => ({
  room: null,
  notice: null,
  set: (patch) => set(patch),
}));
