import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import type { RegisterInput, RegisterStartResponse } from '@thegrave/shared';
import { createMailer, verificationEmail, type Mailer } from '../../lib/mailer.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { AuthError, createVerifiedUser, type IssuedTokens } from './service.js';

// Pending registrations (decision.md D-076): nothing touches Postgres until the emailed code is verified.
// One Redis hash per email, plus a username reservation so two people can't race for the same name.
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS = 5;
const MAX_ATTEMPTS = 5;
// Per-email budget across restarts and resends: stops the form being used to flood someone's inbox, and
// bounds guessing to MAX_ATTEMPTS × EMAILS_PER_HOUR tries an hour against a 1-in-a-million code.
const EMAILS_PER_HOUR = 10;
const sendsKey = (email: string) => `reg:sends:${email}`;

const pendingKey = (email: string) => `reg:pending:${email}`;
const usernameKey = (username: string) => `reg:username:${username.toLowerCase()}`;

let mailer: Mailer | undefined;
const getMailer = () => (mailer ??= createMailer());

/** A uniformly random 6-digit code. Stored hashed with the email so a leaked Redis dump isn't a code list. */
const newCode = () => randomInt(0, 1_000_000).toString().padStart(6, '0');
const hashCode = (code: string, email: string) =>
  createHash('sha256').update(`${code}:${email}`).digest('hex');

// Lua keeps each read-modify-write atomic on the single Redis node (no WATCH: the connection is shared).
// Count an attempt before the caller compares, so parallel guesses can't beat the cap. Returns the
// hash as a flat array with attempts already incremented, or nil if there is no pending registration.
const ATTEMPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return nil end
redis.call('HINCRBY', KEYS[1], 'attempts', 1)
return redis.call('HGETALL', KEYS[1])`;

// Resend: cooldown, send cap, then swap in the new code. Returns {status, a, b, username}:
// 0 = nothing pending, 1 = cooling down (a = retry ms), 2 = send cap hit, 3 = ok (a = expiresAt, b = resendAt).
const RESEND = `
if redis.call('EXISTS', KEYS[1]) == 0 then return {0} end
local now = tonumber(ARGV[1])
local resendAt = tonumber(redis.call('HGET', KEYS[1], 'resendAt'))
if now < resendAt then return {1, resendAt - now} end
if tonumber(redis.call('HGET', KEYS[1], 'sends')) >= tonumber(ARGV[5]) then return {2} end
local expiresAt = now + tonumber(ARGV[3])
local resendNext = now + tonumber(ARGV[4])
redis.call('HSET', KEYS[1], 'codeHash', ARGV[2], 'attempts', 0, 'expiresAt', expiresAt, 'resendAt', resendNext)
redis.call('HINCRBY', KEYS[1], 'sends', 1)
redis.call('PEXPIRE', KEYS[1], ARGV[3])
local username = redis.call('HGET', KEYS[1], 'username')
redis.call('PEXPIRE', KEYS[2] .. string.lower(username), ARGV[3])
return {3, expiresAt, resendNext, username}`;

/** Spends one email from the address's hourly budget; throws 429 once it is used up. */
async function spendEmailBudget(email: string) {
  const [[, sent], [, ttl]] = (await redis
    .multi()
    .incr(sendsKey(email))
    .pttl(sendsKey(email))
    .exec()) as [[null, number], [null, number]];
  if (ttl < 0) await redis.pexpire(sendsKey(email), 60 * 60 * 1000);
  if (sent > EMAILS_PER_HOUR)
    throw new AuthError(
      429,
      'Too many codes sent to this email, try again later',
      {},
      ttl > 0 ? ttl : 60 * 60 * 1000,
    );
}

async function send(email: string, username: string, code: string) {
  await getMailer().send(verificationEmail(email, username, code));
}

/** Drops the pending registration and, if it is still ours, its username reservation. */
async function discard(email: string, username: string) {
  await redis.del(pendingKey(email));
  if ((await redis.get(usernameKey(username))) === email) await redis.del(usernameKey(username));
}

export async function startRegistration(input: RegisterInput): Promise<RegisterStartResponse> {
  const { username, email, institution } = input;
  const taken = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
    select: { id: true },
  });
  if (taken) throw new AuthError(409, 'Username or email is already in use');
  await spendEmailBudget(email);

  // A restart for the same email replaces its pending registration, so free the old username first.
  const previous = await redis.hget(pendingKey(email), 'username');
  if (previous && previous.toLowerCase() !== username.toLowerCase()) await discard(email, previous);

  const now = Date.now();
  const reserved = await redis.set(usernameKey(username), email, 'PX', CODE_TTL_MS, 'NX');
  if (!reserved) {
    // Held by us from an earlier start: fine, the TTL is refreshed below. Anyone else: taken.
    if ((await redis.get(usernameKey(username))) !== email)
      throw new AuthError(409, 'Username is taken');
    await redis.pexpire(usernameKey(username), CODE_TTL_MS);
  }

  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const code = newCode();
  const expiresAt = now + CODE_TTL_MS;
  const resendAt = now + RESEND_COOLDOWN_MS;
  await redis
    .multi()
    .del(pendingKey(email))
    .hset(pendingKey(email), {
      username,
      email,
      institution,
      passwordHash,
      codeHash: hashCode(code, email),
      attempts: 0,
      sends: 1,
      expiresAt,
      resendAt,
    })
    .pexpire(pendingKey(email), CODE_TTL_MS)
    .exec();
  await send(email, username, code);
  return { email, expiresAt, resendAvailableAt: resendAt };
}

export async function resendCode(email: string): Promise<RegisterStartResponse> {
  const code = newCode();
  const res = (await redis.eval(
    RESEND,
    2,
    pendingKey(email),
    'reg:username:',
    Date.now(),
    hashCode(code, email),
    CODE_TTL_MS,
    RESEND_COOLDOWN_MS,
    MAX_SENDS,
  )) as [number, number?, number?, string?];
  const [status, a, b, username] = res;
  if (status === 0) throw new AuthError(404, 'No pending registration for this email, start again');
  if (status === 1) throw new AuthError(429, 'Please wait before requesting another code', {}, a);
  if (status === 2) throw new AuthError(429, 'Too many codes requested, start again later');
  await spendEmailBudget(email);
  await send(email, username!, code);
  return { email, expiresAt: a!, resendAvailableAt: b! };
}

export async function verifyRegistration(email: string, code: string): Promise<IssuedTokens> {
  const flat = (await redis.eval(ATTEMPT, 1, pendingKey(email))) as string[] | null;
  if (!flat) throw new AuthError(400, 'Code expired or not found');
  const p: Record<string, string> = {};
  for (let i = 0; i < flat.length; i += 2) p[flat[i]!] = flat[i + 1]!;

  const given = Buffer.from(hashCode(code, email));
  const stored = Buffer.from(p.codeHash!);
  const match = given.length === stored.length && timingSafeEqual(given, stored);
  const attempts = Number(p.attempts);
  if (!match) {
    const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attempts);
    if (attemptsLeft === 0) await discard(email, p.username!);
    throw new AuthError(400, 'Incorrect code', { attemptsLeft });
  }

  // Limitation: the username reservation and pending hash are deleted after the user insert, not in
  // the same transaction as it. A crash in between leaves them to expire; the unique indexes still win.
  const issued = await createVerifiedUser({
    username: p.username!,
    email,
    institution: p.institution!,
    passwordHash: p.passwordHash!,
  });
  await discard(email, p.username!);
  return issued;
}
