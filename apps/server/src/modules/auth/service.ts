import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { LoginInput, PublicUser } from '@thegrave/shared';
import { config } from '../../config.js';
import { Prisma } from '../../generated/prisma/client.js';
import { avatarUrl } from '../../lib/avatar.js';
import { prisma } from '../../lib/prisma.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../lib/tokens.js';

export class AuthError extends Error {
  constructor(
    public readonly statusCode: 400 | 401 | 404 | 409 | 429,
    message: string,
    /** Extra JSON fields for the response body, e.g. attemptsLeft (decision.md D-076). */
    public readonly extra: Record<string, unknown> = {},
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: PublicUser;
}

const INVALID_CREDENTIALS = 'Invalid email or password';
const INVALID_SESSION = 'Session expired, please log in again';

// Verified against when the email is unknown, so login takes the same time either way (no user enumeration).
const dummyHash = argon2.hash('timing-equaliser-not-a-real-password', { type: argon2.argon2id });

const toPublicUser = (u: {
  id: string;
  username: string;
  email: string;
  institution: string | null;
  rating: number;
  avatarUpdatedAt: Date | null;
}): PublicUser => ({
  id: u.id,
  username: u.username,
  email: u.email,
  institution: u.institution,
  rating: Math.round(u.rating),
  avatarUrl: avatarUrl(u),
});

async function issueTokens(
  user: Parameters<typeof toPublicUser>[0],
  familyId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<IssuedTokens> {
  const refreshToken = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + config.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await tx.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      familyId,
      expiresAt: refreshExpiresAt,
    },
  });
  return {
    accessToken: signAccessToken({ sub: user.id, username: user.username }),
    refreshToken,
    refreshExpiresAt,
    user: toPublicUser(user),
  };
}

/**
 * Creates the account once its email code has been verified (decision.md D-076) and logs it in.
 * The password arrives already hashed: it was hashed when registration started.
 */
export async function createVerifiedUser(input: {
  username: string;
  email: string;
  institution: string;
  passwordHash: string;
}): Promise<IssuedTokens> {
  try {
    const user = await prisma.user.create({ data: { ...input, emailVerifiedAt: new Date() } });
    return await issueTokens(user, randomUUID());
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AuthError(409, 'Username or email is already in use');
    }
    throw err;
  }
}

export async function login(input: LoginInput): Promise<IssuedTokens> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const ok = await argon2.verify(user?.passwordHash ?? (await dummyHash), input.password);
  if (!user || user.isBot || !ok) throw new AuthError(401, INVALID_CREDENTIALS);
  return issueTokens(user, randomUUID());
}

/**
 * Rotates a refresh token. Presenting an already-revoked token means it was stolen or replayed,
 * so the whole family is revoked and every session descended from that login is logged out.
 */
export async function refresh(rawToken: string): Promise<IssuedTokens> {
  const tokenHash = hashRefreshToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!existing) throw new AuthError(401, INVALID_SESSION);

  if (existing.revokedAt) {
    await revokeFamily(existing.familyId);
    throw new AuthError(401, INVALID_SESSION);
  }
  if (existing.expiresAt <= new Date()) throw new AuthError(401, INVALID_SESSION);

  const issued = await prisma.$transaction(async (tx) => {
    // Conditional update: if a concurrent request rotated this token first, count is 0 → treat as reuse.
    const { count } = await tx.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) return null;
    return issueTokens(existing.user, existing.familyId, tx);
  });
  if (!issued) {
    await revokeFamily(existing.familyId);
    throw new AuthError(401, INVALID_SESSION);
  }
  return issued;
}

/** Ends the session the token belongs to. Unknown tokens are ignored so logout is idempotent. */
export async function logout(rawToken: string): Promise<void> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
  });
  if (existing) await revokeFamily(existing.familyId);
}

async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getUser(id: string): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? toPublicUser(user) : null;
}
