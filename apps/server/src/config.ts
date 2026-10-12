import { z } from 'zod';

// Fail fast on boot if the environment is misconfigured.
const envSchema = z.object({
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
  // Backpressure: reject new submissions with 503 once this many are waiting.
  JUDGE_QUEUE_MAX: z.coerce.number().int().positive().default(500),
});

export const config = envSchema.parse(process.env);
export type Config = typeof config;
