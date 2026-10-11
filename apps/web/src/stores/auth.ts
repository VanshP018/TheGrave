import type { AuthResponse, PublicUser } from '@thegrave/shared';
import { create } from 'zustand';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: Status;
  // Held in memory only, never in localStorage (decision.md D-007).
  accessToken: string | null;
  user: PublicUser | null;
  setSession: (session: AuthResponse) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  status: 'loading',
  accessToken: null,
  user: null,
  setSession: ({ accessToken, user }) => set({ status: 'authenticated', accessToken, user }),
  clear: () => set({ status: 'anonymous', accessToken: null, user: null }),
}));
