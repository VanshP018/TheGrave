import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { HintError, type HintModel } from '../src/hints/model.js';
import { prisma } from '../src/lib/prisma.js';
import { projectData, projects } from '../src/seed/projects.js';
import { closeAll, registerUser, resetState } from './helpers.js';

// The hint bot (decision.md D-075): scoped to one challenge, never leaks the hidden suite or the fix.
const def = projects.find((p) => p.slug === 'shopping-cart')!;
const url = `/api/projects/${def.slug}/hint`;

type Input = Parameters<HintModel['reply']>[0];
let captured: Input | null = null;
let failWith: HintError | null = null;
const model: HintModel = {
  async reply(input) {
    if (failWith) throw failWith;
    captured = input;
    return 'Try running the demo first.';
  },
};

// A string only the reference fix contains (the starter lacks it).
const solutionOnly = Object.values(def.solution)
  .flatMap((c) => c.split('\n'))
  .map((l) => l.trim())
  .find((l) => l.length > 12 && !Object.values(def.files).some((f) => f.includes(l)))!;
const hiddenOnly = Object.values(def.hiddenTests)
  .flatMap((c) => c.split('\n'))
  .map((l) => l.trim())
  .find((l) => l.length > 12 && !Object.values(def.files).some((f) => f.includes(l)))!;

describe('hints API', () => {
  let app: FastifyInstance;
  let noModel: FastifyInstance;
  let alice: { authorization: string };
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp({ hintModel: model });
    noModel = await buildApp({ hintModel: null });
    await app.ready();
    await noModel.ready();
    await resetState();
    await prisma.project.deleteMany();
    projectId = (await prisma.project.create({ data: { slug: def.slug, ...projectData(def) } })).id;
    alice = await registerUser(app, 'alice');
    await registerUser(app, 'bob');
  });
  afterAll(async () => {
    await noModel.close();
    await closeAll(app);
  });

  const files = { ...def.files, 'notes.txt': 'my-distinctive-scratch-note' };
  const body = { messages: [{ role: 'user', content: 'Where do I start?' }], files };
  const post = (payload: unknown, headers = alice, a = app, path = url) =>
    a.inject({ method: 'POST', url: path, payload: payload as object, headers });

  it('is 503 when no model is configured', async () => {
    expect((await post(body, alice, noModel)).statusCode).toBe(503);
  });

  it('rejects bad bodies and unknown projects', async () => {
    const user = (content: string) => ({ role: 'user' as const, content });
    const bad = [
      { ...body, messages: [user('hi'), { role: 'assistant', content: 'yo' }] },
      { ...body, messages: Array.from({ length: 21 }, (_, i) => user(`q${i}`)) },
      { ...body, messages: [user('')] },
      { ...body, messages: [user('x'.repeat(2001))] },
      { ...body, messages: [] },
    ];
    for (const b of bad) expect((await post(b)).statusCode).toBe(400);
    expect((await post(body, alice, app, '/api/projects/nope/hint')).statusCode).toBe(404);
  });

  it('answers with the model reply and a prompt scoped to this challenge', async () => {
    const res = await post({
      ...body,
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'a nudge' },
        { role: 'user', content: 'Where do I start?' },
      ],
      activeFile: 'notes.txt',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: 'Try running the demo first.' });

    const sent = JSON.stringify(captured);
    expect(sent).toContain(JSON.stringify(def.statement.split('\n')[0]).slice(1, -1));
    expect(sent).toContain('my-distinctive-scratch-note');
    expect(sent).toContain('Where do I start?');
    expect(sent).toContain('active_file=');
    expect(captured!.messages).toHaveLength(3);
    expect(captured!.messages[1]).toEqual({ role: 'assistant', content: 'a nudge' });
    expect(captured!.system[1]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(sent).not.toContain('__grave__');
    expect(sent).not.toContain(hiddenOnly);
    expect(sent).not.toContain(solutionOnly);
  });

  it('maps model failures to friendly statuses', async () => {
    for (const [code, status] of [
      ['busy', 429],
      ['unconfigured', 503],
      ['unavailable', 502],
    ] as const) {
      failWith = new HintError(code);
      expect((await post(body)).statusCode).toBe(status);
    }
    failWith = null;
  });

  it('is off while the caller is in a live battle on this codebase', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'alice' } });
    const other = await prisma.user.findUniqueOrThrow({ where: { username: 'bob' } });
    const now = Date.now();
    await prisma.match.create({
      data: {
        mode: 'PROGRAMMING',
        projectId,
        status: 'ACTIVE',
        startsAt: new Date(now - 1000),
        endsAt: new Date(now + 600_000),
        players: {
          create: [
            { userId: user.id, ratingBefore: 1500 },
            { userId: other.id, ratingBefore: 1500 },
          ],
        },
      },
    });
    const res = await post(body);
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toBe('Hints are off during a battle on this codebase');
  });
});
