import { prisma } from '../lib/prisma.js';
import { buildTestCases, STARTER_CODE } from './build.js';
import { problems } from './problems.js';
import { projectData, projects } from './projects.js';
import { TAGS } from './tags.js';

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
        tags: TAGS[def.slug] ?? [],
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
for (const def of projects) {
  const data = projectData(def);
  await prisma.project.upsert({
    where: { slug: def.slug },
    create: { slug: def.slug, ...data },
    update: data,
  });
  console.log(`project ${def.slug.padEnd(24)} ${data.hiddenTestCount} hidden tests`);
}
console.log(`seeded ${projects.length} projects`);
await prisma.$disconnect();
