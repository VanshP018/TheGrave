// The whole backend in one process for Playwright: API + Socket.IO + battle jobs + the real Docker judge.
// Started by playwright.config.ts with an isolated database (thegrave_e2e) and Redis DB 2.
import { buildApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { DockerExecutor } from '../../src/judge/docker-executor.js';
import { createJudgeWorker } from '../../src/judge/worker.js';
import { resolveBudget } from '../../src/interviews/budget.js';
import { InterviewError } from '../../src/interviews/errors.js';
import { FakeInterviewLlm } from '../../src/interviews/fake-llm.js';
import { MemoryRepoSource, type RepoSource } from '../../src/interviews/source.js';
import { createInterviewWorker } from '../../src/interviews/worker.js';
import { attachRealtime } from '../../src/realtime/index.js';
import { WorkspaceExecutor } from '../../src/workspace/executor.js';
import { createWorkspaceWorker } from '../../src/workspace/worker.js';
import { docsOnly, expressApi } from '../fixtures/interview-repos.js';

const app = await buildApp();
attachRealtime(app);
const judge = createJudgeWorker(new DockerExecutor({ image: config.JUDGE_IMAGE }), {
  concurrency: 4,
});
const workspace = createWorkspaceWorker(new WorkspaceExecutor({ image: config.WORKSPACE_IMAGE }), {
  concurrency: 2,
});
// Interviews: two in-memory repos and the deterministic fake LLM; any other repo is "not found". No network.
const fixtureRepos: Record<string, MemoryRepoSource> = {
  'grave-fixtures/express-api': new MemoryRepoSource(expressApi, { description: 'Orders service' }),
  'grave-fixtures/docs-only': new MemoryRepoSource(docsOnly),
};
const interviewSource: RepoSource = {
  resolve: (ref) => {
    const repo = fixtureRepos[`${ref.owner}/${ref.repo}`.toLowerCase()];
    if (!repo) throw new InterviewError('REPO_NOT_FOUND');
    return repo.resolve(ref);
  },
  tree: (meta) => pick(meta).tree(),
  readFile: (meta, path, maxBytes) => pick(meta).readFile(meta, path, maxBytes),
  history: () => pick(undefined).history(),
};
function pick(meta?: { owner: string; repo: string }): MemoryRepoSource {
  const repo = meta ? fixtureRepos[`${meta.owner}/${meta.repo}`.toLowerCase()] : undefined;
  return repo ?? fixtureRepos['grave-fixtures/express-api']!;
}
const interviewBudget = resolveBudget(config);
const interviews = createInterviewWorker(
  { source: interviewSource, llm: new FakeInterviewLlm(interviewBudget), budget: interviewBudget },
  { concurrency: 1 },
);
await app.listen({ port: config.PORT, host: '127.0.0.1' });
console.log(`e2e backend listening on ${config.PORT}`);

const stop = async () => {
  await Promise.all([judge.close(), workspace.close(), interviews.close()]);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
