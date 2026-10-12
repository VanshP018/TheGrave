import { defineConfig } from 'vitest/config';

// Integration tests hit real Postgres/Redis, isolated from dev data: database `thegrave_test`, Redis DB 1.
export const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://grave:grave@localhost:5442/thegrave_test?schema=public',
  REDIS_URL: 'redis://localhost:6389/1',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdefghijklmnop',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdefghijklmnop',
};

export default defineConfig({
  test: {
    env: testEnv,
    globalSetup: ['./test/global-setup.ts'],
    include: ['test/**/*.test.ts'],
    // Files share one database, so run them one at a time.
    fileParallelism: false,
    // Judge tests start real containers.
    testTimeout: 60_000,
  },
});
