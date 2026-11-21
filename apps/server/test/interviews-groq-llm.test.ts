import { beforeAll, describe, expect, it } from 'vitest';
import { InterviewError } from '../src/interviews/errors.js';
import { chatResult, ScriptedLlmClient } from '../src/interviews/fake-llm.js';
import { GroqApiError } from '../src/interviews/groq-client.js';
import { GroqInterviewLlm } from '../src/interviews/groq-llm.js';
import { LlmOutputError, type WriteInput } from '../src/interviews/llm.js';
import {
  buildCritiqueBatches,
  buildProfileText,
  buildTriageInput,
  buildWriterMessages,
  difficultyList,
  estimateMessages,
} from '../src/interviews/prompts.js';
import { expressApi } from './fixtures/interview-repos.js';
import { prepare, signal } from './fixtures/interview-setup.js';

type Prepared = Awaited<ReturnType<typeof prepare>>;
let p: Prepared;
let input: WriteInput;

const models = {
  writer: 'openai/gpt-oss-120b',
  triage: 'openai/gpt-oss-20b',
  critique: 'openai/gpt-oss-20b',
};
const validWriter = JSON.stringify({ questions: [] });
const validTriage = JSON.stringify({
  summary: 's',
  apparentLevel: 'MID',
  focusAreas: [],
  files: [],
});

beforeAll(async () => {
  p = await prepare(expressApi, 'developer');
  input = {
    level: 'MID',
    levelInferred: false,
    profileText: buildProfileText(p.profile, 'summary'),
    shard: p.shards[0]!,
    shardIndex: 0,
    shardCount: 1,
    count: 14,
    difficulties: difficultyList('MID', 14),
    focusAreas: [],
    accepted: [],
    rejected: [],
    topUp: false,
    maxOut: p.budget.writerMaxOut,
  };
});

const llm = (
  client: ScriptedLlmClient,
  extra: {
    jsonMode?: 'json_object' | 'json_schema';
    budget?: Prepared['budget'];
    writer?: string;
  } = {},
) =>
  new GroqInterviewLlm(client, {
    budget: extra.budget ?? p.budget,
    models: { ...models, writer: extra.writer ?? models.writer },
    jsonMode: extra.jsonMode,
  });

describe('GroqInterviewLlm', () => {
  it('sends a strict json_schema request for a strict-capable model', async () => {
    const client = new ScriptedLlmClient([chatResult(validWriter)]);
    const res = await llm(client).write(input, signal);
    expect(res.data).toEqual({ questions: [] });
    const { req, opts } = client.requests[0]!;
    expect(req.responseFormat).toMatchObject({ type: 'json_schema', name: 'interview_questions' });
    expect(req.reasoningEffort).toBe('medium');
    expect(req.maxCompletionTokens).toBe(p.budget.writerMaxOut);
    expect(req.messages[0]!.content).not.toContain('Output format');
    expect(opts.reserveTokens).toBe(estimateMessages(req.messages) + p.budget.writerMaxOut);
    expect(opts.timeoutMs).toBe(p.budget.writerTimeoutMs);
  });

  it('uses json_object mode with the format appendix for a non-strict model', async () => {
    const client = new ScriptedLlmClient([chatResult(validWriter)]);
    await llm(client, { writer: 'llama-3.3-70b-versatile' }).write(input, signal);
    const { req } = client.requests[0]!;
    expect(req.responseFormat).toEqual({ type: 'json_object' });
    expect(req.messages[0]!.content).toContain('Output format');
    expect(req.reasoningEffort).toBeUndefined(); // reasoning_effort is gpt-oss only
  });

  it('honours a forced json mode', async () => {
    const client = new ScriptedLlmClient([chatResult(validWriter)]);
    await llm(client, { jsonMode: 'json_object' }).write(input, signal);
    expect(client.requests[0]!.req.responseFormat).toEqual({ type: 'json_object' });
  });

  it('repairs invalid JSON once, sending the zod issues', async () => {
    const client = new ScriptedLlmClient([chatResult('{"questions": 5}'), chatResult(validWriter)]);
    const res = await llm(client).write(input, signal);
    expect(res.data).toEqual({ questions: [] });
    expect(res.usage).toHaveLength(2);
    expect(client.requests).toHaveLength(2);
    const repair = client.requests[1]!.req.messages;
    expect(repair.at(-2)).toEqual({ role: 'assistant', content: '{"questions": 5}' });
    expect(repair.at(-1)!.role).toBe('user');
    expect(repair.at(-1)!.content).toContain('did not match the required JSON schema');
    expect(repair.at(-1)!.content).toContain('questions');
    expect(repair.slice(0, 3)).toEqual(client.requests[0]!.req.messages);
  });

  it('repairs after a model-JSON 400, echoing the failed generation', async () => {
    const bad = new GroqApiError(
      400,
      'Generated JSON does not match',
      null,
      'json_validate_failed',
      '{"qu',
      true,
    );
    const client = new ScriptedLlmClient([bad, chatResult(validTriage)]);
    const res = await llm(client).triage(buildTriageInput(p.profile, p.budget), signal);
    expect(res.data.apparentLevel).toBe('MID');
    expect(
      client.requests[1]!.req.messages.some((m) => m.role === 'assistant' && m.content === '{"qu'),
    ).toBe(true);
  });

  it('triage fails with LlmOutputError when the repair is invalid too (pipeline falls back)', async () => {
    const client = new ScriptedLlmClient([chatResult('nope'), chatResult('still nope')]);
    const err = await llm(client)
      .triage(buildTriageInput(p.profile, p.budget), signal)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmOutputError);
    expect((err as LlmOutputError).usage).toHaveLength(2);
    expect(client.requests).toHaveLength(2);
  });

  it('a writer shard that stays invalid yields no questions, keeping its usage', async () => {
    const client = new ScriptedLlmClient([chatResult('nope'), chatResult('{"questions":1}')]);
    const res = await llm(client).write(input, signal);
    expect(res.data.questions).toEqual([]);
    expect(res.usage).toHaveLength(2);
  });

  it('critique fails with LlmOutputError when invalid twice (critique is skipped)', async () => {
    const client = new ScriptedLlmClient([chatResult('x'), chatResult('y')]);
    const [batch] = buildCritiqueBatches(
      'MID',
      's',
      [
        {
          index: 0,
          question: 'q',
          category: 'TESTING',
          difficulty: 'EASY',
          whyAsked: 'w',
          snippets: [],
        },
      ],
      p.budget,
    );
    await expect(llm(client).critique(batch!, signal)).rejects.toBeInstanceOf(LlmOutputError);
  });

  it('retries once with fewer questions when the reply was cut off', async () => {
    const client = new ScriptedLlmClient([
      chatResult('{"questions":[', { finishReason: 'length' }),
      chatResult(validWriter),
    ]);
    const res = await llm(client).write(input, signal);
    expect(res.data).toEqual({ questions: [] });
    const [first, second] = client.requests.map((r) => r.req.messages.at(-1)!.content);
    expect(first).toContain('exactly 14 questions');
    expect(second).toContain('exactly 10 questions');
    expect(second).toContain('about 2 EASY, 5 MEDIUM, 3 HARD');
  });

  it('gives up after a second cut-off', async () => {
    const client = new ScriptedLlmClient([
      chatResult('{', { finishReason: 'length' }),
      chatResult('{', { finishReason: 'length' }),
    ]);
    const res = await llm(client).write(input, signal);
    expect(res.data.questions).toEqual([]);
    expect(client.requests).toHaveLength(2);
  });

  it('skips the repair when it would not fit the request cap', async () => {
    const first = buildWriterMessages(input);
    const budget = {
      ...p.budget,
      maxRequestTokens: estimateMessages(first) + p.budget.writerMaxOut + 5,
    };
    const client = new ScriptedLlmClient([chatResult('nope')]);
    const res = await llm(client, { budget }).write(input, signal);
    expect(res.data.questions).toEqual([]);
    expect(client.requests).toHaveLength(1);
  });

  it('maps content_filter to AI_REFUSED and propagates client errors', async () => {
    const refused = new ScriptedLlmClient([chatResult('', { finishReason: 'content_filter' })]);
    await expect(llm(refused).write(input, signal)).rejects.toMatchObject({ code: 'AI_REFUSED' });
    const busy = new ScriptedLlmClient([
      new InterviewError('AI_BUSY', undefined, { retryable: true }),
    ]);
    await expect(llm(busy).write(input, signal)).rejects.toMatchObject({
      code: 'AI_BUSY',
      retryable: true,
    });
  });

  it('passes the wait callback and deadline to the client', async () => {
    const client = new ScriptedLlmClient([chatResult(validWriter)]);
    const onWait = () => {};
    await llm(client).write(input, signal, { onWait, deadline: 123 });
    expect(client.requests[0]!.opts).toMatchObject({ onWait, deadline: 123 });
  });
});
