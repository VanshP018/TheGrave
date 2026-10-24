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
execSync('docker build -q -t thegrave-workspace:latest workspace', { stdio: 'ignore' });

// Imported after migrations so the client sees the current schema.
const { prisma } = await import('../../src/lib/prisma.js');
const { buildTestCases, STARTER_CODE } = await import('../../src/seed/build.js');
const { problems } = await import('../../src/seed/problems.js');
const { TAGS } = await import('../../src/seed/tags.js');
const { projectData, projects } = await import('../../src/seed/projects.js');

await prisma.$executeRawUnsafe('TRUNCATE "User", "Problem", "Project" CASCADE');
// Exactly one problem, so every battle gets it and the tests know a correct solution.
const def = problems.find((p) => p.slug === 'sum-of-array')!;
await prisma.problem.create({
  data: {
    slug: def.slug,
    title: def.title,
    difficulty: def.difficulty,
    statement: def.statement,
    starterCode: STARTER_CODE,
    tags: TAGS[def.slug],
    testCases: { create: buildTestCases(def) },
  },
});
// All programming challenges (decision.md D-066).
for (const p of projects)
  await prisma.project.create({ data: { slug: p.slug, ...projectData(p) } });

// A veteran with 30 rated games (played through the real Glicko-2 code) and four ranked rivals,
// so the leaderboard and profile have realistic data. The server rebuilds the leaderboard on boot.
const argon2 = (await import('argon2')).default;
const { rate } = await import('../../src/rating/glicko2.js');
const passwordHash = await argon2.hash('correct-horse-battery', { type: argon2.argon2id });
const DAY = 24 * 60 * 60 * 1000;
const rivals = await Promise.all(
  [1720, 1650, 1580, 1490].map((rating, i) =>
    prisma.user.create({
      data: {
        username: `rival${i}`,
        email: `rival${i}@e2e.test`,
        passwordHash,
        institution: 'Grave Academy',
        emailVerifiedAt: new Date(),
        rating,
        ratingDev: 70,
        ratedGames: 20,
      },
    }),
  ),
);
const vet = await prisma.user.create({
  data: {
    username: 'veteran',
    email: 'veteran@e2e.test',
    passwordHash,
    institution: 'Grave Academy',
    emailVerifiedAt: new Date(),
    createdAt: new Date(Date.now() - 40 * DAY),
  },
});
const problem = await prisma.problem.findFirstOrThrow();
let r = { rating: 1500, rd: 350, volatility: 0.06 };
let seed = 3;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 30; i++) {
  const opp = rivals[i % rivals.length]!;
  const score = rand() < 0.6 ? 1 : rand() < 0.8 ? 0 : 0.5;
  const after = rate(
    r,
    [{ opponent: { rating: opp.rating, rd: opp.ratingDev }, score: score as 0 | 0.5 | 1 }],
    {
      periodFraction: 0,
    },
  );
  const at = new Date(Date.now() - (30 - i) * DAY);
  const m = await prisma.match.create({
    data: {
      problemId: problem.id,
      status: 'FINISHED',
      startsAt: at,
      endsAt: at,
      finishedAt: at,
      ratedAt: at,
      winnerId: score === 1 ? vet.id : score === 0 ? opp.id : null,
      endReason: score === 0.5 ? 'TIMEOUT' : 'SOLVED',
      players: {
        create: [
          { userId: vet.id, ratingBefore: r.rating },
          { userId: opp.id, ratingBefore: opp.rating },
        ],
      },
    },
  });
  await prisma.ratingHistory.create({
    data: {
      userId: vet.id,
      matchId: m.id,
      opponentId: opp.id,
      outcome: score === 1 ? 'WIN' : score === 0 ? 'LOSS' : 'DRAW',
      ratingBefore: r.rating,
      ratingAfter: after.rating,
      delta: after.rating - r.rating,
      rdBefore: r.rd,
      rdAfter: after.rd,
      volatilityBefore: r.volatility,
      volatilityAfter: after.volatility,
      opponentRating: opp.rating,
      createdAt: at,
    },
  });
  r = after;
}
await prisma.user.update({
  where: { id: vet.id },
  data: {
    rating: r.rating,
    ratingDev: r.rd,
    volatility: r.volatility,
    ratedGames: 30,
    rdUpdatedAt: new Date(Date.now() - DAY),
  },
});
await prisma.$disconnect();

const redis = new Redis(process.env.REDIS_URL!);
await redis.flushdb();
await redis.quit();
console.log('e2e environment ready');
