import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { BOTS } from '../bots/roster.js';
import { prisma } from '../lib/prisma.js';

/** A bot's stored RD: low, so a human's rating moves as it would against an established player. */
export const BOT_RATING_DEV = 40;

/**
 * Creates or refreshes the practice bot accounts (idempotent). A bot cannot log in: its password is a hash of
 * a random secret nobody ever sees, and login also refuses `isBot` accounts outright. If a human already
 * holds a bot's name, the bot becomes `<name>_bot` instead of touching that account.
 */
export async function seedBots(): Promise<
  { username: string; rating: number; created: boolean }[]
> {
  const passwordHash = await argon2.hash(randomBytes(32).toString('hex'), {
    type: argon2.argon2id,
  });
  const out: { username: string; rating: number; created: boolean }[] = [];
  for (const b of BOTS) {
    const email = `${b.username.toLowerCase()}@bots.grave.invalid`;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { isBot: true, rating: b.rating, ratingDev: BOT_RATING_DEV, bio: b.bio },
      });
      out.push({ username: existing.username, rating: b.rating, created: false });
      continue;
    }
    const taken = await prisma.user.findUnique({ where: { username: b.username } });
    const username = taken ? `${b.username}_bot` : b.username;
    await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        emailVerifiedAt: new Date(),
        rating: b.rating,
        ratingDev: BOT_RATING_DEV,
        bio: b.bio,
        isBot: true,
      },
    });
    out.push({ username, rating: b.rating, created: true });
  }
  return out;
}
