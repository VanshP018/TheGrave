import { prisma } from '../lib/prisma.js';
import { buildTestCases, STARTER_CODE } from './build.js';
import { problems } from './problems.js';

// Idempotent: upserts problems by slug and replaces their test cases.
for (const def of problems) {
  const started = performance.now();
  const tests = buildTestCases(def);
  await prisma.$transaction(
    async (tx) => {
      const data = {
        title: def.title,
        difficulty: def.difficulty,
        statement: def.statement,
        timeLimitMs: def.timeLimitMs ?? 1000,
        starterCode: STARTER_CODE,
      };
      const problem = await tx.problem.upsert({
        where: { slug: def.slug },
        create: { slug: def.slug, ...data },
        update: data,
      });
      await tx.testCase.deleteMany({ where: { problemId: problem.id } });
      await tx.testCase.createMany({ data: tests.map((t) => ({ ...t, problemId: problem.id })) });
    },
    { timeout: 60_000 },
  );
  const ms = Math.round(performance.now() - started);
  console.log(
    `${def.difficulty.padEnd(6)} ${def.slug.padEnd(32)} ${String(tests.length).padStart(2)} tests  ${ms}ms`,
  );
}
console.log(`seeded ${problems.length} problems`);
await prisma.$disconnect();
