import { createHmac, randomBytes } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config.js';

export interface AccessClaims {
  sub: string;
  username: string;
}

const ISSUER = 'thegrave';

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign({ username: claims.username }, config.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: claims.sub,
    issuer: ISSUER,
    expiresIn: config.JWT_ACCESS_TTL as SignOptions['expiresIn'],
  });
}

/** Throws on a bad signature, wrong algorithm, wrong issuer or expiry. */
export function verifyAccessToken(token: string): AccessClaims {
  const payload = jwt.verify(token, config.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: ISSUER,
  });
  if (typeof payload === 'string' || !payload.sub || typeof payload.username !== 'string') {
    throw new Error('malformed access token');
  }
  return { sub: payload.sub, username: payload.username };
}

/** Opaque 256-bit refresh token; only its keyed hash is stored (see decision.md D-018). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHmac('sha256', config.JWT_REFRESH_SECRET).update(token).digest('hex');
}
