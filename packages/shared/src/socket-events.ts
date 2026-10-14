// Socket.IO contract shared by server and client: matchmaking (Phase 3) and battles (Phase 4).
import type { MatchResult, PlayerProgress } from './battle.js';

export interface Opponent {
  id: string;
  username: string;
  rating: number;
}

export type AckError =
  | 'ALREADY_IN_MATCH' // user:{id}:state says ready-check or match
  | 'NOT_QUEUED'
  | 'MATCH_NOT_FOUND' // ready check expired, was cancelled, or you are not part of it
  | 'RATE_LIMITED'
  | 'INTERNAL';

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; code: AckError; message: string };

export type QueueLeftReason = 'requested' | 'disconnected' | 'expired';
export type MatchCancelReason = 'declined' | 'timeout';

export interface ServerToClientEvents {
  /** Sent to every socket of the user, so all tabs stay in sync. */
  'queue:joined': (payload: { joinedAt: number }) => void;
  'queue:left': (payload: { reason: QueueLeftReason }) => void;
  'queue:stats': (payload: { queued: number }) => void;
  /** Ready check: both players must `match:accept` before `expiresAt` (server epoch ms). */
  'match:found': (payload: { matchId: string; opponent: Opponent; expiresAt: number }) => void;
  'match:accepted': (payload: { matchId: string; userId: string }) => void;
  'match:confirmed': (payload: { matchId: string; opponent: Opponent }) => void;
  /** `requeued` is true when you accepted (or did nothing wrong) and were put back in the queue. */
  'match:cancelled': (payload: {
    matchId: string;
    reason: MatchCancelReason;
    requeued: boolean;
  }) => void;

  /** Both players accepted and the match exists; open /battle/{matchId}. */
  'battle:created': (payload: { matchId: string; startsAt: number; endsAt: number }) => void;
  'battle:started': (payload: { matchId: string }) => void;
  /** Sent on every submit and verdict, for both players. Progress only, never code. */
  'battle:progress': (payload: { matchId: string; player: PlayerProgress }) => void;
  'battle:finished': (payload: { matchId: string; result: MatchResult }) => void;
  /** One of *your* battle submissions finished judging; fetch /api/submissions/{id} for details. */
  'submission:judged': (payload: { matchId: string; submissionId: string }) => void;
}

export interface ClientToServerEvents {
  'queue:join': (ack: (res: Ack<{ joinedAt: number }>) => void) => void;
  'queue:leave': (ack: (res: Ack) => void) => void;
  'match:accept': (payload: { matchId: string }, ack: (res: Ack) => void) => void;
  'match:decline': (payload: { matchId: string }, ack: (res: Ack) => void) => void;
  /** NTP-style clock sync: client sends nothing, server acks with its epoch ms. */
  'time:sync': (ack: (res: { serverNow: number }) => void) => void;
}

/** Room every socket of a user joins, so events reach all tabs on all nodes. */
export const userRoom = (userId: string) => `user:${userId}`;
/** Room for everyone in a battle. */
export const matchRoom = (matchId: string) => `match:${matchId}`;
