import { create } from 'zustand';

interface BattleUiState {
  /** Your draw offer was just declined (decision.md D-068); shown briefly, then cleared. */
  drawDeclined: boolean;
  set: (patch: Partial<Omit<BattleUiState, 'set'>>) => void;
}

export const useBattleUi = create<BattleUiState>((set) => ({
  drawDeclined: false,
  set: (patch) => set(patch),
}));
