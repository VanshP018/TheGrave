import type { Difficulty } from './judge.js';

/** Private rooms (decision.md D-065): a host shares a code, one friend joins, the host starts an unrated battle. */
export type RoomDifficulty = 'AUTO' | Difficulty;

export interface RoomPlayer {
  id: string;
  username: string;
  rating: number;
}

export interface RoomView {
  code: string;
  host: RoomPlayer;
  guest: RoomPlayer | null;
  guestReady: boolean;
  /** AUTO picks by the players' average rating, like ranked. */
  difficulty: RoomDifficulty;
}

export type RoomClosedReason = 'left' | 'host-left' | 'kicked' | 'start-failed';

/** Codes avoid look-alike characters (0/O, 1/I/L) so they survive being read out loud. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
export const normalizeRoomCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
