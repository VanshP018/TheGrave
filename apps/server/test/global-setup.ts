import { execSync } from 'node:child_process';
import pg from 'pg';
import { testEnv } from '../vitest.config.js';

export default async function setup() {
  const url = new URL(testEnv.DATABASE_URL);
  const dbName = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testEnv.DATABASE_URL },
    stdio: 'ignore',
  });
}
