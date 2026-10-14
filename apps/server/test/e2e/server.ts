// The whole backend in one process for Playwright: API + Socket.IO + battle jobs + the real Docker judge.
// Started by playwright.config.ts with an isolated database (thegrave_e2e) and Redis DB 2.
import { buildApp } from '../../src/app.js';
import { config } from '../../src/config.js';
import { DockerExecutor } from '../../src/judge/docker-executor.js';
import { createJudgeWorker } from '../../src/judge/worker.js';
import { attachRealtime } from '../../src/realtime/index.js';

const app = await buildApp();
attachRealtime(app);
const judge = createJudgeWorker(new DockerExecutor({ image: config.JUDGE_IMAGE }), {
  concurrency: 4,
});
await app.listen({ port: config.PORT, host: '127.0.0.1' });
console.log(`e2e backend listening on ${config.PORT}`);

const stop = async () => {
  await judge.close();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
