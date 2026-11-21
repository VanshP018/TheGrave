import { describe, expect, it } from 'vitest';
import { envSchema } from '../src/config.js';

// Production refuses to start with development leftovers (decision.md D-080).
const good = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://thegrave:Zx9-longrandompassword@db:5432/thegrave',
  REDIS_URL: 'redis://redis:6379',
  JWT_ACCESS_SECRET: 'q7Jv2kLw9PzXn4RtYb8HcFd3GsAe6MuVo1BiKx5Wj0Q=',
  JWT_REFRESH_SECRET: 'T3mNfZc8RyUa5HdLp2WsKe9XgBq7VjOi4YtCu1Aw6Fk=',
  CORS_ORIGIN: 'https://thegrave.example',
  SMTP_HOST: 'in-v3.mailjet.com',
  TRUST_PROXY: '1',
};
const problems = (env: Record<string, unknown>) => {
  const r = envSchema.safeParse(env);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
};

describe('production config', () => {
  it('accepts a correct production environment', () => {
    expect(problems(good)).toEqual([]);
    expect(envSchema.parse(good).TRUST_PROXY).toBe(1);
  });

  it.each([
    ['no SMTP', { SMTP_HOST: undefined }, 'SMTP_HOST'],
    ['the fake hint model', { HINT_MODEL: 'fake' }, 'HINT_MODEL'],
    ['the fake interview model', { INTERVIEW_MODEL: 'fake' }, 'INTERVIEW_MODEL'],
    ['a non-https origin', { CORS_ORIGIN: 'http://thegrave.example' }, 'CORS_ORIGIN'],
    ['localhost as origin', { CORS_ORIGIN: 'http://localhost:5173' }, 'CORS_ORIGIN'],
    ['identical JWT secrets', { JWT_REFRESH_SECRET: good.JWT_ACCESS_SECRET }, 'JWT_REFRESH_SECRET'],
    [
      'a placeholder secret',
      { JWT_ACCESS_SECRET: 'change-me-change-me-change-me-change-me' },
      'JWT_ACCESS_SECRET',
    ],
    ['a short secret', { JWT_ACCESS_SECRET: 'short' }, 'JWT_ACCESS_SECRET'],
    [
      'the development database password',
      { DATABASE_URL: 'postgresql://grave:grave@db:5432/thegrave' },
      'DATABASE_URL',
    ],
    ['a bad proxy setting', { TRUST_PROXY: 'maybe' }, 'TRUST_PROXY'],
  ])('rejects %s', (_label, change, path) => {
    expect(problems({ ...good, ...change })).toContain(path);
  });

  it('is relaxed in development', () => {
    expect(
      problems({
        ...good,
        NODE_ENV: 'development',
        SMTP_HOST: undefined,
        HINT_MODEL: 'fake',
        CORS_ORIGIN: 'http://localhost:5173',
      }),
    ).toEqual([]);
  });
});
