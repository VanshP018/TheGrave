// Socket.IO contract shared by server and client. Filled in during Phase 3 (matchmaking) and Phase 4 (battle).
export interface ServerToClientEvents {
  'queue:joined': (payload: { position: number }) => void;
  'match:found': (payload: { matchId: string; opponent: { id: string; username: string; rating: number } }) => void;
  error: (payload: { code: string; message: string }) => void;
}

export interface ClientToServerEvents {
  'queue:join': () => void;
  'queue:leave': () => void;
}
