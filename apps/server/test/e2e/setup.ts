// Prepares the isolated E2E environment: database, migrations, one known problem, empty Redis DB.
import { execSync } from 'node:child_process';
import { Redis } from 'ioredis';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL!;
const url = new URL(DATABASE_URL);
const dbName = url.pathname.slice(1);
url.pathname = '/postgres';
const admin = new pg.Client({ connectionString: url.toString() });
await admin.connect();
if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])).rowCount) {
  await admin.query(`CREATE DATABASE "${dbName}"`);
}
await admin.end();

execSync('pnpm exec prisma migrate deploy', { stdio: 'ignore', env: process.env });
execSync('docker build -q -t thegrave-judge:latest judge', { stdio: 'ignore' });

// Imported after migrations so the client sees the current schema.
const { prisma } = await import('../../src/lib/prisma.js');
const { buildTestCases, STARTER_CODE } = await import('../../src/seed/build.js');
const { problems } = await import('../../src/seed/problems.js');

await prisma.$executeRawUnsafe('TRUNCATE "User", "Problem" CASCADE');
// Exactly one problem, so every battle gets it and the tests know a correct solution.
const def = problems.find((p) => p.slug === 'sum-of-array')!;
await prisma.problem.create({
  data: {
    slug: def.slug,
    title: def.title,
    difficulty: def.difficulty,
    statement: def.statement,
    starterCode: STARTER_CODE,
    testCases: { create: buildTestCases(def) },
  },
});
await prisma.$disconnect();

const redis = new Redis(process.env.REDIS_URL!);
await redis.flushdb();
await redis.quit();
console.log('e2e environment ready');
