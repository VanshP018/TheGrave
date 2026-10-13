import type { ClientToServerEvents, ServerToClientEvents } from '@thegrave/shared';
import { io, type Socket } from 'socket.io-client';
import { useAuth } from '../stores/auth';
import { refreshSession } from './api';

export type GraveSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GraveSocket | null = null;

/** One socket per tab, created on first use. Same origin: the Vite proxy / reverse proxy forwards /socket.io. */
export function getSocket(): GraveSocket {
  if (socket) return socket;
  const s: GraveSocket = io({
    transports: ['websocket'],
    autoConnect: false,
    // A function, so every (re)connect sends the *current* in-memory access token.
    auth: (cb) => cb({ token: useAuth.getState().accessToken }),
  });
  s.on('connect_error', async (err) => {
    // Access token expired while disconnected: refresh once, then retry.
    if (err.message === 'unauthorized' && (await refreshSession())) s.connect();
  });
  socket = s;
  return s;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
