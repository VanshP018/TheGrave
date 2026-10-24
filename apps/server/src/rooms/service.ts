import { randomInt } from 'node:crypto';
import {
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type Ack,
  type AckError,
  type Difficulty,
  MATCH_MODES,
  type MatchMode,
  type RoomDifficulty,
  type RoomPlayer,
  type RoomView,
} from '@thegrave/shared';
import type { Redis } from 'ioredis';
import type { BattleNotifier, BattleService } from '../battle/service.js';
import { prisma } from '../lib/prisma.js';
import type { Matchmaker } from '../matchmaking/matchmaker.js';
import { roomScripts } from './scripts.js';

export interface RoomOptions {
  /** An idle room (and its members' state) expires after this long; every join refreshes it. */
  ttlMs: number;
  /** A member whose last socket closes is removed only if they are still gone after this long (reloads). */
  graceMs: number;
}

export const DEFAULT_ROOM_OPTIONS: RoomOptions = { ttlMs: 2 * 60 * 60 * 1000, graceMs: 15_000 };

const DIFFICULTIES: RoomDifficulty[] = ['AUTO', 'EASY', 'MEDIUM', 'HARD'];
const fail = (code: AckError, message: string) => ({ ok: false as const, code, message });

const BUSY_MESSAGE = (state: string) =>
  state.startsWith('room:')
    ? fail('IN_ROOM', 'You are already in a room')
    : state.startsWith('queued')
      ? fail('IN_QUEUE', 'Leave the ranked queue first')
      : fail('ALREADY_IN_MATCH', 'You are already in a match');

/**
 * Private rooms (decision.md D-065): a host creates a room and shares its code, one friend joins and
 * readies up, the host starts. The battle itself is an ordinary match, just unrated and with the
 * host's chosen difficulty, so every battle rule (clock, judging, forfeits) applies unchanged.
 */
export class RoomService {
  readonly opts: RoomOptions;
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly redis: Redis,
    private readonly notify: BattleNotifier,
    private readonly battle: BattleService,
    private readonly mm: Matchmaker,
    opts: Partial<RoomOptions> = {},
  ) {
    this.opts = { ...DEFAULT_ROOM_OPTIONS, ...opts };
  }

  async create(userId: string, mode: MatchMode = 'DSA'): Promise<Ack<{ room: RoomView }>> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from(
        { length: ROOM_CODE_LENGTH },
        () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)],
      ).join('');
      const [status, state] = await roomScripts.create.run<[string, string?]>(this.redis, [
        code,
        userId,
        this.opts.ttlMs,
        MATCH_MODES.includes(mode) ? mode : 'DSA',
      ]);
      if (status === 'busy') return BUSY_MESSAGE(state!);
      if (status === 'ok') return this.joined(code);
    }
    return fail('INTERNAL', 'Could not create a room, try again');
  }

  async join(userId: string, rawCode: string): Promise<Ack<{ room: RoomView }>> {
    const code = normalizeRoomCode(rawCode);
    if (code.length !== ROOM_CODE_LENGTH) return fail('ROOM_NOT_FOUND', 'That code is not valid');
    const [status, state] = await roomScripts.join.run<[string, string?]>(this.redis, [
      code,
      userId,
      this.opts.ttlMs,
    ]);
    if (status === 'busy') return BUSY_MESSAGE(state!);
    if (status === 'gone') return fail('ROOM_NOT_FOUND', 'No room with that code');
    if (status === 'full') return fail('ROOM_FULL', 'That room is full');
    return this.joined(code);
  }

  async leave(userId: string): Promise<boolean> {
    const res = await roomScripts.leave.run<string[]>(this.redis, [userId]);
    if (res[0] === 'none') return false;
    const [kind, code, other] = res as [string, string, string];
    if (kind === 'closed') {
      this.notify.toUser(userId, 'room:closed', { code, reason: 'left' });
      if (other) this.notify.toUser(other, 'room:closed', { code, reason: 'host-left' });
    } else {
      this.notify.toUser(userId, 'room:closed', { code, reason: 'left' });
      await this.broadcast(code);
    }
    return true;
  }

  async update(
    userId: string,
    patch: { difficulty?: unknown; mode?: unknown; ready?: unknown; kick?: unknown },
  ): Promise<Ack> {
    let res: string[];
    if (patch.kick === true) {
      res = await roomScripts.update.run(this.redis, [userId, 'kick', '']);
    } else if (typeof patch.ready === 'boolean') {
      res = await roomScripts.update.run(this.redis, [userId, 'ready', patch.ready ? '1' : '0']);
    } else if (MATCH_MODES.includes(patch.mode as MatchMode)) {
      res = await roomScripts.update.run(this.redis, [userId, 'mode', patch.mode as string]);
    } else if (DIFFICULTIES.includes(patch.difficulty as RoomDifficulty)) {
      res = await roomScripts.update.run(this.redis, [
        userId,
        'difficulty',
        patch.difficulty as string,
      ]);
    } else {
      return fail('NOT_ALLOWED', 'Nothing to change');
    }
    if (res[0] === 'none') return fail('ROOM_NOT_FOUND', 'You are not in a room');
    if (res[0] === 'denied') return fail('NOT_ALLOWED', 'Only the host can do that');
    if (res[0] === 'kicked')
      this.notify.toUser(res[2]!, 'room:closed', { code: res[1]!, reason: 'kicked' });
    await this.broadcast(res[1]!);
    return { ok: true };
  }

  async start(userId: string): Promise<Ack> {
    const res = await roomScripts.start.run<string[]>(this.redis, [
      userId,
      this.mm.opts.matchStateTtlMs,
    ]);
    if (res[0] === 'none') return fail('ROOM_NOT_FOUND', 'You are not in a room');
    if (res[0] === 'denied')
      return fail('NOT_ALLOWED', 'Only the host can start, once the guest is ready');
    const [, code, hostId, guestId, difficulty, mode] = res as [
      string,
      string,
      string,
      string,
      string,
      MatchMode,
    ];
    const readyId = `room-${code}`;
    try {
      const players = await this.players([hostId, guestId]);
      await this.battle.createMatch(
        { matchId: readyId, players: [players.get(hostId)!, players.get(guestId)!], mode },
        {
          difficulty: difficulty === 'AUTO' ? undefined : (difficulty as Difficulty),
          rated: false,
          mode,
        },
      );
      return { ok: true };
    } catch {
      await this.mm.release(readyId, [hostId, guestId]);
      for (const id of [hostId, guestId])
        this.notify.toUser(id, 'room:closed', { code, reason: 'start-failed' });
      return fail('INTERNAL', 'Could not start the battle');
    }
  }

  /** The user's room, for resyncing a (re)connecting socket. */
  async current(userId: string): Promise<RoomView | null> {
    const st = await this.redis.get(`user:${userId}:state`);
    const code = st?.startsWith('room:') ? st.slice('room:'.length) : null;
    return code ? this.view(code) : null;
  }

  /** The user's last socket closed: drop them from their room unless they come back within the grace. */
  scheduleLeave(userId: string) {
    clearTimeout(this.timers.get(userId));
    this.timers.set(
      userId,
      setTimeout(() => {
        this.timers.delete(userId);
        void (async () => {
          if (!(await this.notify.isConnected(userId))) await this.leave(userId);
        })().catch(() => {});
      }, this.opts.graceMs),
    );
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }

  private async view(code: string): Promise<RoomView | null> {
    const h = await this.redis.hgetall(`room:${code}`);
    if (!h.host) return null;
    const players = await this.players([h.host, h.guest].filter((id): id is string => !!id));
    return {
      code,
      host: players.get(h.host)!,
      guest: h.guest ? (players.get(h.guest) ?? null) : null,
      guestReady: h.ready === '1',
      difficulty: (h.difficulty as RoomDifficulty) ?? 'AUTO',
      mode: (h.mode as MatchMode) ?? 'DSA',
    };
  }

  /** Sends the current room to both members and returns it (null if it closed in the meantime). */
  private async broadcast(code: string): Promise<RoomView | null> {
    const room = await this.view(code);
    if (room)
      for (const p of [room.host, room.guest])
        if (p) this.notify.toUser(p.id, 'room:updated', room);
    return room;
  }

  private async joined(code: string): Promise<Ack<{ room: RoomView }>> {
    const room = await this.broadcast(code);
    return room ? { ok: true, room } : fail('ROOM_NOT_FOUND', 'That room just closed');
  }

  private async players(ids: string[]): Promise<Map<string, RoomPlayer>> {
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, username: true, rating: true },
    });
    return new Map(users.map((u) => [u.id, { ...u, rating: Math.round(u.rating) }]));
  }
}
