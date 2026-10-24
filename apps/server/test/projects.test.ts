import type { ProjectRunView, ProjectSummary } from '@thegrave/shared';
import type { Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { countHiddenTests, projectData, projects } from '../src/seed/projects.js';
import { WorkspaceExecutor } from '../src/workspace/executor.js';
import { workspaceQueue } from '../src/workspace/queue.js';
import { createWorkspaceWorker } from '../src/workspace/worker.js';
import { closeAll, registerUser, resetState, setupApp } from './helpers.js';

const exec = new WorkspaceExecutor({ image: 'thegrave-workspace:latest' });

// Every codebase must be a fair puzzle: the starter fails the hidden suite, the reference fix passes all of it,
// and the suite size the grader expects matches what actually runs.
describe.concurrent('programming challenges are well-formed', () => {
  for (const p of projects) {
    it(p.slug, async () => {
      const fixed = await exec.run(
        p.language,
        { ...p.files, ...p.solution, ...p.hiddenTests },
        { mode: 'test', testDir: '__grave__' },
        20_000,
      );
      expect(
        fixed.results.filter((r) => r.status !== 'pass'),
        fixed.output,
      ).toEqual([]);
      expect(fixed.results).toHaveLength(countHiddenTests(p));

      const starter = await exec.run(
        p.language,
        { ...p.files, ...p.hiddenTests },
        { mode: 'test', testDir: '__grave__' },
        20_000,
      );
      expect(starter.results.some((r) => r.status !== 'pass')).toBe(true);

      const visible = await exec.run(
        p.language,
        p.files,
        { mode: 'test', testDir: 'tests' },
        20_000,
      );
      expect(visible.results.length).toBeGreaterThan(0);
      expect(visible.results.some((r) => r.status !== 'pass')).toBe(true);
    });
  }
});

describe('sandbox', () => {
  it('runs commands without network and times them out', async () => {
    const net = await exec.run(
      'python',
      {},
      {
        mode: 'exec',
        command:
          'python3 -c "import urllib.request as u; u.urlopen(\'http://1.1.1.1\', timeout=2)"',
      },
      8000,
    );
    expect(net.exitCode).not.toBe(0);
    const loop = await exec.run('node', {}, { mode: 'exec', command: 'node -e "for(;;){}"' }, 1500);
    expect(loop.timedOut).toBe(true);
  });
});

describe('projects API', () => {
  let app: FastifyInstance;
  let worker: Worker;
  let alice: { authorization: string };
  let bob: { authorization: string };
  const def = projects.find((p) => p.slug === 'shopping-cart')!;

  beforeAll(async () => {
    app = await setupApp();
    await resetState();
    await prisma.project.deleteMany();
    await prisma.project.create({ data: { slug: def.slug, ...projectData(def) } });
    alice = await registerUser(app, 'alice');
    bob = await registerUser(app, 'bob');
    worker = createWorkspaceWorker(exec, { concurrency: 2 });
  });
  afterAll(async () => {
    await worker.close();
    await workspaceQueue.close();
    await closeAll(app);
  });

  const post = (payload: object, headers = alice) =>
    app.inject({ method: 'POST', url: `/api/projects/${def.slug}/runs`, payload, headers });
  async function waitFor(id: string): Promise<ProjectRunView> {
    for (;;) {
      const r = (
        await app.inject({ method: 'GET', url: `/api/project-runs/${id}`, headers: alice })
      ).json() as ProjectRunView;
      if (r.status === 'DONE' || r.status === 'FAILED') return r;
      await new Promise((res) => setTimeout(res, 200));
    }
  }
  const list = async () =>
    (
      await app.inject({ method: 'GET', url: '/api/projects', headers: alice })
    ).json() as ProjectSummary[];

  it('lists and opens projects without leaking the hidden tests', async () => {
    expect(await list()).toEqual([
      expect.objectContaining({
        slug: def.slug,
        solved: false,
        attempted: false,
        fileCount: Object.keys(def.files).length,
      }),
    ]);
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${def.slug}`,
      headers: alice,
    });
    expect(res.json().files).toEqual(def.files);
    expect(res.body).not.toContain('test_hidden');
    expect(res.body).not.toContain('__grave__');
  });

  it('rejects writes into the hidden test folder and unsafe paths', async () => {
    for (const path of ['__grave__/test_hidden.py', '../x.py', '/etc/passwd', 'a//b.py'])
      expect(
        (await post({ kind: 'TEST', files: { ...def.files, [path]: 'x' } })).statusCode,
        path,
      ).toBe(400);
    expect((await post({ kind: 'COMMAND', files: def.files })).statusCode).toBe(400); // no command
  });

  it('runs a terminal command, the visible tests, and grades a submission', async () => {
    const cmd = await waitFor(
      (await post({ kind: 'COMMAND', command: 'python3 main.py', files: def.files })).json().id,
    );
    expect(cmd).toMatchObject({ kind: 'COMMAND', status: 'DONE', exitCode: 0 });
    expect(cmd.output).toContain('Subtotal');

    const visible = await waitFor((await post({ kind: 'TEST', files: def.files })).json().id);
    expect(visible.total).toBe(2);
    expect(visible.passed).toBeLessThan(2);

    const failing = await waitFor((await post({ kind: 'SUBMIT', files: def.files })).json().id);
    expect(failing.total).toBe(countHiddenTests(def));
    expect(failing.passed).toBeLessThan(failing.total!);
    expect(await list()).toEqual([expect.objectContaining({ solved: false, attempted: true })]);

    const fixed = await waitFor(
      (await post({ kind: 'SUBMIT', files: { ...def.files, ...def.solution } })).json().id,
    );
    expect(fixed.passed).toBe(fixed.total);
    expect(await list()).toEqual([expect.objectContaining({ solved: true })]);
  });

  it('a suite that exits early is not a pass', async () => {
    const run = await waitFor(
      (
        await post({
          kind: 'SUBMIT',
          files: { ...def.files, 'cart/__init__.py': 'import os\nos._exit(0)\n' },
        })
      ).json().id,
    );
    expect(run.total).toBe(countHiddenTests(def));
    expect(run.passed).toBe(0);
  });

  it("hides other users' runs (404)", async () => {
    const id = (await post({ kind: 'TEST', files: def.files })).json().id;
    const res = await app.inject({ method: 'GET', url: `/api/project-runs/${id}`, headers: bob });
    expect(res.statusCode).toBe(404);
    await waitFor(id);
  });
});
