import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { BOTS } from '../bots/roster.js';
import { prisma } from '../lib/prisma.js';

/** A bot's stored RD: low, so a human's rating moves as it would against an established player. */
export const BOT_RATING_DEV = 40;

const emailFor = (username: string) => `${username.toLowerCase()}@bots.grave.invalid`;

/** The roster name, or that name with a digit if a human already holds it (never touching their account). */
async function freeUsername(wanted: string, ownId?: string): Promise<string> {
  for (let n = 1; n < 20; n++) {
    const candidate = n === 1 ? wanted : `${wanted.slice(0, 19)}${n}`;
    const holder = await prisma.user.findUnique({ where: { username: candidate } });
    if (!holder || holder.id === ownId) return candidate;
  }
  throw new Error(`no free username for ${wanted}`);
}

/**
 * Creates or refreshes the practice bot accounts (idempotent). An account from an earlier roster (`legacy`) is
 * renamed in place, so the matches it already played keep their history. A bot cannot log in: its password is
 * a hash of a random secret nobody sees, and login also refuses `isBot` accounts outright.
 */
export async function seedBots(): Promise<
  { username: string; rating: number; created: boolean; renamed: boolean }[]
> {
  const passwordHash = await argon2.hash(randomBytes(32).toString('hex'), {
    type: argon2.argon2id,
  });
  const out: { username: string; rating: number; created: boolean; renamed: boolean }[] = [];
  for (const b of BOTS) {
    const existing =
      (await prisma.user.findUnique({ where: { email: emailFor(b.username) } })) ??
      (b.legacy
        ? await prisma.user.findFirst({ where: { email: emailFor(b.legacy), isBot: true } })
        : null);
    if (existing) {
      const username = await freeUsername(b.username, existing.id);
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          username,
          email: emailFor(b.username),
          isBot: true,
          rating: b.rating,
          ratingDev: BOT_RATING_DEV,
          bio: b.bio,
        },
      });
      out.push({
        username,
        rating: b.rating,
        created: false,
        renamed: existing.username !== username,
      });
      continue;
    }
    const username = await freeUsername(b.username);
    await prisma.user.create({
      data: {
        username,
        email: emailFor(b.username),
        passwordHash,
        emailVerifiedAt: new Date(),
        rating: b.rating,
        ratingDev: BOT_RATING_DEV,
        bio: b.bio,
        isBot: true,
      },
    });
    out.push({ username, rating: b.rating, created: true, renamed: false });
  }
  return out;
}
