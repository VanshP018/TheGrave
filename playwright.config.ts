import { defineConfig, devices } from '@playwright/test';

// Isolated from dev data: own database, own Redis DB, own ports. Battle timings are shortened
// so the time-out and forfeit scenarios run in seconds (decision.md D-045).
const API_PORT = 4100;
const WEB_PORT = 5174;
const backendEnv = {
  ...process.env,
  NODE_ENV: 'test',
  PORT: String(API_PORT),
  CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
  DATABASE_URL: 'postgresql://grave:grave@localhost:5442/thegrave_e2e?schema=public',
  REDIS_URL: 'redis://localhost:6389/2',
  JWT_ACCESS_SECRET: 'e2e-access-secret-0123456789abcdefghijklmnop',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret-0123456789abcdefghijklmnop',
  BATTLE_COUNTDOWN_MS: '1500',
  BATTLE_DURATION_MS: '20000',
  BATTLE_RECONNECT_GRACE_MS: '4000',
  BATTLE_SUBMIT_COOLDOWN_MS: '1000',
  // Deterministic hint bot, no API key needed (decision.md D-075).
  HINT_MODEL: 'fake',
  // Deterministic interview LLM + in-memory repos (test/e2e/server.ts), no API key needed.
  INTERVIEW_MODEL: 'fake',
};

export const E2E_REDIS_URL = backendEnv.REDIS_URL;

export default defineConfig({
  testDir: 'e2e',
  // One shared matchmaking queue: scenarios must not overlap.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command:
        'pnpm --filter @thegrave/server exec tsx test/e2e/setup.ts && pnpm --filter @thegrave/server exec tsx test/e2e/server.ts',
      url: `http://127.0.0.1:${API_PORT}/health`,
      env: backendEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @thegrave/web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { ...process.env, API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
    },
  ],
});
