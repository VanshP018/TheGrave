import { z } from 'zod';

// Compose passes unset values as empty strings.
const emptyToUndef = (v: unknown) => (v === '' ? undefined : v);
const optionalInt = () =>
  z.preprocess(emptyToUndef, z.coerce.number().int().nonnegative().optional());

// Fail fast on boot if the environment is misconfigured.
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
    EXECUTOR: z.enum(['docker']).default('docker'),
    JUDGE_IMAGE: z.string().default('thegrave-judge:latest'),
    // Optional OCI runtime for judge containers, e.g. `runsc` (gVisor) on dedicated judge hosts.
    JUDGE_RUNTIME: z.string().optional(),
    JUDGE_CONCURRENCY: z.coerce.number().int().positive().default(2),
    // Programming challenges' sandbox (decision.md D-066)
    WORKSPACE_IMAGE: z.string().default('thegrave-workspace:latest'),
    WORKSPACE_CONCURRENCY: z.coerce.number().int().positive().default(2),
    // Backpressure: reject new submissions with 503 once this many are waiting.
    JUDGE_QUEUE_MAX: z.coerce.number().int().positive().default(500),
    // Battles (decision.md D-040..D-044). The duration override exists for E2E tests.
    BATTLE_COUNTDOWN_MS: z.coerce.number().int().nonnegative().default(5000),
    BATTLE_DURATION_MS: z.coerce.number().int().positive().optional(),
    BATTLE_RECONNECT_GRACE_MS: z.coerce.number().int().positive().default(30_000),
    BATTLE_SUBMIT_COOLDOWN_MS: z.coerce.number().int().nonnegative().default(5000),
    // Practice bots fill in when few players are online (a player waiting this long with no human opponent
    // is matched with the roster bot closest in rating). On by default, off in tests unless set explicitly.
    BOTS_ENABLED: z
      .enum(['true', 'false', '1', '0'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1')),
    BOT_MATCH_AFTER_MS: z.coerce.number().int().nonnegative().default(6000),
    // AI hint bot for practice challenges (decision.md D-075). Off unless a key is set; HINT_MODEL=fake is a
    // deterministic stand-in for E2E and local dev.
    ANTHROPIC_API_KEY: z.string().optional(),
    HINT_MODEL: z.string().default('claude-sonnet-5-5'),
    // OpenAI-compatible alternatives to Anthropic. HINT_PROVIDER picks one; unset = the first key that is set
    // (Anthropic, then DeepSeek, then Groq).
    // Characters of the player's files sent with each question. Lower it for providers with small token limits
    // (Groq's free tier allows 8000 tokens/minute).
    HINT_WORKSPACE_CAP: z.coerce
      .number()
      .int()
      .positive()
      .default(120 * 1024),
    HINT_PROVIDER: z.preprocess(
      (v) => (v === '' ? undefined : v), // compose passes unset values as empty strings
      z.enum(['anthropic', 'deepseek', 'groq']).optional(),
    ),
    DEEPSEEK_API_KEY: z.string().optional(),
    DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
    DEEPSEEK_BASE_URL: z.string().default('https://api.deepseek.com'),
    GROQ_API_KEY: z.string().optional(),
    GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
    GROQ_BASE_URL: z.string().default('https://api.groq.com/openai/v1'),
    // Interview prep from GitHub repos (plan.md). Groq only: off unless GROQ_API_KEY (shared with the hint coach)
    // or INTERVIEW_GROQ_API_KEY is set; INTERVIEW_MODEL=fake is a deterministic stand-in for E2E and local dev.
    INTERVIEW_GROQ_API_KEY: z.preprocess(emptyToUndef, z.string().optional()),
    GROQ_TIER: z.enum(['free', 'developer']).default('developer'),
    INTERVIEW_MODEL: z.string().default('openai/gpt-oss-120b'),
    INTERVIEW_TRIAGE_MODEL: z.string().default('openai/gpt-oss-20b'),
    INTERVIEW_CRITIQUE_MODEL: z.string().default('openai/gpt-oss-20b'),
    INTERVIEW_WRITER_EFFORT: z.preprocess(
      emptyToUndef,
      z.enum(['low', 'medium', 'high']).optional(),
    ), // tier default
    INTERVIEW_JSON_MODE: z.enum(['auto', 'json_schema', 'json_object']).default('auto'),
    GITHUB_TOKEN: z.preprocess(emptyToUndef, z.string().optional()),
    INTERVIEW_CONCURRENCY: z.coerce.number().int().positive().default(1),
    INTERVIEW_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(2),
    INTERVIEW_MAX_REPO_MB: z.coerce.number().int().positive().default(500),
    // Unset = the GROQ_TIER profile value (interviews/budget.ts); set to override one number.
    INTERVIEW_DAILY_LIMIT: optionalInt(),
    INTERVIEW_QUEUE_MAX: optionalInt(),
    INTERVIEW_MAX_REQUEST_TOKENS: optionalInt(),
    INTERVIEW_CONTEXT_TOKENS: optionalInt(),
    INTERVIEW_TPM_BUDGET: optionalInt(),
    INTERVIEW_DAILY_TOKENS: optionalInt(),
    INTERVIEW_JOB_TIMEOUT_MS: optionalInt(),
    // Outgoing mail for registration codes (decision.md D-076). Without SMTP_HOST, development logs the
    // message to the console and test writes to a Redis outbox; production refuses to boot.
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_SECURE: z
      .enum(['true', 'false', '1', '0'])
      .default('false')
      .transform((v) => v === 'true' || v === '1'),
    MAIL_FROM: z.string().default('TheGrave <no-reply@thegrave.dev>'),
    // How many reverse proxies sit in front of the API (decision.md D-080). Behind Caddy that is 1; without
    // it every user shares the proxy's IP and therefore one rate-limit bucket. `false` = no proxy.
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((v): boolean | number =>
        v === 'true' ? true : v === 'false' ? false : Number.parseInt(v, 10),
      )
      .refine((v) => v === true || v === false || (Number.isInteger(v) && v >= 1), {
        message: 'TRUST_PROXY must be true, false or a hop count like 1',
      }),
  })
  // Production refuses to start with development leftovers (decision.md D-080).
  .superRefine((c, ctx) => {
    if (c.NODE_ENV !== 'production') return;
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (!c.SMTP_HOST)
      fail('SMTP_HOST', 'SMTP_HOST is required in production (registration codes are emailed)');
    if (c.HINT_MODEL === 'fake') fail('HINT_MODEL', 'HINT_MODEL=fake is for tests and dev only');
    if (c.INTERVIEW_MODEL === 'fake')
      fail('INTERVIEW_MODEL', 'INTERVIEW_MODEL=fake is for tests and dev only');
    if (!c.CORS_ORIGIN.startsWith('https://'))
      fail('CORS_ORIGIN', 'CORS_ORIGIN must be the public https:// origin of the site');
    if (c.JWT_ACCESS_SECRET === c.JWT_REFRESH_SECRET)
      fail('JWT_REFRESH_SECRET', 'the access and refresh secrets must differ');
    for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const)
      if (/change-?me|secret|password|example/i.test(c[k]))
        fail(k, `${k} looks like a placeholder; generate one with: openssl rand -base64 48`);
    if (/grave:grave@/.test(c.DATABASE_URL))
      fail('DATABASE_URL', 'DATABASE_URL still uses the development password');
  });

export const config = envSchema.parse(process.env);
export type Config = typeof config;
