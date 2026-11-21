import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InterviewError } from '../src/interviews/errors.js';
import { GroqApiError, GroqClient } from '../src/interviews/groq-client.js';
import type { ChatRequest } from '../src/interviews/llm.js';
import { GroqLimiter, parseGroqDuration } from '../src/interviews/rate-limit.js';
import { redis } from '../src/lib/redis.js';

const MODEL = 'openai/gpt-oss-120b';
const prefix = `test:groq:${Math.random().toString(36).slice(2)}`;
const signal = new AbortController().signal;

let clock: { t: number };
let sleeps: number[];
const now = () => clock.t;
const sleep = async (ms: number) => {
  sleeps.push(ms);
  clock.t += ms;
};

const req: ChatRequest = {
  model: MODEL,
  messages: [{ role: 'user', content: 'hi' }],
  responseFormat: { type: 'json_schema', name: 'x', schema: { type: 'object' } },
  reasoningEffort: 'medium',
  maxCompletionTokens: 500,
};
const call = { signal, timeoutMs: 30_000, reserveTokens: 1000 };

function ok(extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 600,
        completion_tokens: 200,
        prompt_tokens_details: { cached_tokens: 100 },
        completion_tokens_details: { reasoning_tokens: 50 },
        ...extra,
      },
    }),
    { status: 200, headers },
  );
}

function fail(
  status: number,
  message: string,
  headers: Record<string, string> = {},
  code?: string,
) {
  return new Response(JSON.stringify({ error: { message, type: 'x', code } }), { status, headers });
}

function setup(
  responses: (Response | Error)[],
  budget = { tpm: 100_000, rpm: 100, dailyTokens: 0 },
) {
  const bodies: Record<string, unknown>[] = [];
  const fetchStub = vi.fn(async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init!.body)));
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  });
  const limiter = new GroqLimiter(redis, budget, now, prefix);
  const client = new GroqClient({
    apiKey: 'k',
    baseUrl: 'https://groq.test/v1',
    limiter,
    fetch: fetchStub as unknown as typeof fetch,
    now,
    sleep,
    random: () => 0,
  });
  return { client, limiter, fetchStub, bodies };
}

beforeEach(() => {
  clock = { t: 1_800_000_000_000 };
  sleeps = [];
});
afterEach(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length) await redis.del(...keys);
});
afterAll(async () => {
  await redis.quit();
});

describe('parseGroqDuration', () => {
  it.each([
    ['7.66s', 7660],
    ['2m59.56s', 179_560],
    ['1h0m0s', 3_600_000],
    ['250ms', 250],
    ['1h2m3s', 3_723_000],
  ])('%s', (text, ms) => expect(parseGroqDuration(text)).toBe(ms));

  it('returns null for garbage', () => {
    expect(parseGroqDuration('soon')).toBeNull();
    expect(parseGroqDuration('')).toBeNull();
    expect(parseGroqDuration(null)).toBeNull();
  });
});

describe('GroqClient', () => {
  it('sends a strict json_schema request and never reasoning_format, tools, streaming or temperature', async () => {
    const { client, bodies, fetchStub } = setup([ok()]);
    const res = await client.chat(req, call);
    const body = bodies[0]!;
    expect(String(fetchStub.mock.calls[0]![0])).toBe('https://groq.test/v1/chat/completions');
    expect(body).toMatchObject({
      model: MODEL,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'x', strict: true, schema: { type: 'object' } },
      },
      reasoning_effort: 'medium',
      include_reasoning: false,
      max_completion_tokens: 500,
      stream: false,
    });
    for (const k of ['reasoning_format', 'tools', 'temperature'])
      expect(body).not.toHaveProperty(k);
    expect(res).toMatchObject({
      content: '{"a":1}',
      finishReason: 'stop',
      usage: { inputTokens: 600, outputTokens: 200, cachedInputTokens: 100, reasoningTokens: 50 },
    });
  });

  it('uses json_object without a schema', () => {
    const { client } = setup([]);
    expect(client.buildBody({ ...req, responseFormat: { type: 'json_object' } })).toMatchObject({
      response_format: { type: 'json_object' },
    });
  });

  it('waits out a 429 with retry-after: 3, calls onWait and succeeds', async () => {
    const { client, fetchStub } = setup([
      fail(429, 'Rate limit reached for tokens per minute (TPM)', { 'retry-after': '3' }),
      ok(),
    ]);
    const onWait = vi.fn();
    const res = await client.chat(req, { ...call, onWait });
    expect(res.content).toBe('{"a":1}');
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(onWait).toHaveBeenCalledTimes(1);
    const slept = sleeps.reduce((a, b) => a + b, 0);
    expect(slept).toBeGreaterThanOrEqual(3000);
    expect(slept).toBeLessThan(4000);
    expect(onWait.mock.calls[0]![0]).toBeInstanceOf(Date);
  });

  it('gives up with AI_CAPACITY on a long retry-after and sets the exhausted key', async () => {
    const { client, limiter, fetchStub } = setup([fail(429, 'limit', { 'retry-after': '3600' })]);
    await expect(client.chat(req, call)).rejects.toMatchObject({ code: 'AI_CAPACITY' });
    expect(await limiter.exhaustedUntil(MODEL)).toBe(clock.t + 3_600_000);
    expect(await redis.exists(`${prefix}:exhausted:${MODEL}`)).toBe(1);
    // and the next call does not even reach Groq
    await expect(client.chat(req, call)).rejects.toMatchObject({ code: 'AI_CAPACITY' });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('treats a daily limit message as AI_CAPACITY', async () => {
    const { client } = setup([
      fail(429, 'Rate limit reached for model in organization on tokens per day (TPD)', {
        'retry-after': '60',
      }),
    ]);
    await expect(client.chat(req, call)).rejects.toMatchObject({ code: 'AI_CAPACITY' });
  });

  it('gives up with a retryable AI_BUSY after repeated 429s', async () => {
    const { client, fetchStub } = setup(
      Array.from({ length: 5 }, () => fail(429, 'busy', { 'retry-after': '1' })),
    );
    const err = (await client.chat(req, call).catch((e: unknown) => e)) as InterviewError;
    expect(err).toBeInstanceOf(InterviewError);
    expect(err).toMatchObject({ code: 'AI_BUSY', retryable: true });
    expect(err.retryAt).toBeInstanceOf(Date);
    expect(fetchStub).toHaveBeenCalledTimes(4);
  });

  it('fails with AI_BUSY instead of waiting past the job deadline', async () => {
    const { client } = setup([fail(429, 'busy', { 'retry-after': '90' })]);
    await expect(client.chat(req, { ...call, deadline: clock.t + 60_000 })).rejects.toMatchObject({
      code: 'AI_BUSY',
      retryable: true,
    });
  });

  it('does not retry a 413', async () => {
    const { client, fetchStub } = setup([fail(413, 'Request too large')]);
    await expect(client.chat(req, call)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404])('does not retry a %i', async (status) => {
    const { client, fetchStub } = setup([fail(status, 'nope')]);
    await expect(client.chat(req, call)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('retries 500 twice and then succeeds', async () => {
    const { client, fetchStub } = setup([fail(500, 'boom'), fail(500, 'boom'), ok()]);
    const res = await client.chat(req, call);
    expect(res.content).toBe('{"a":1}');
    expect(fetchStub).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([2000, 4000]);
  });

  it('gives up after three server errors, and retries a connection error', async () => {
    const a = setup([fail(503, 'x'), fail(503, 'x'), fail(503, 'x')]);
    await expect(a.client.chat(req, call)).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
      retryable: true,
    });
    expect(a.fetchStub).toHaveBeenCalledTimes(3);
    const b = setup([new TypeError('fetch failed'), ok()]);
    expect((await b.client.chat(req, call)).finishReason).toBe('stop');
  });

  it('retries a 422 once', async () => {
    const { client, fetchStub } = setup([fail(422, 'x'), fail(422, 'x')]);
    await expect(client.chat(req, call)).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('surfaces a JSON-generation 400 for the repair path', async () => {
    const { client, fetchStub } = setup([
      fail(
        400,
        'Generated JSON does not match the expected schema. Please adjust your prompt.',
        {},
        'json_validate_failed',
      ),
    ]);
    const err = await client.chat(req, call).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GroqApiError);
    expect((err as GroqApiError).jsonFailure).toBe(true);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('maps an aborted job to TIMEOUT', async () => {
    const { client } = setup([new DOMException('aborted', 'AbortError')]);
    const ac = new AbortController();
    ac.abort();
    await expect(client.chat(req, { ...call, signal: ac.signal })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('settles a reservation to prompt - cached + completion', async () => {
    const { client, limiter } = setup([
      ok({
        prompt_tokens: 3000,
        completion_tokens: 500,
        prompt_tokens_details: { cached_tokens: 2000 },
      }),
    ]);
    await client.chat(req, { ...call, reserveTokens: 4000 });
    expect(await limiter.windowTokens(MODEL)).toBe(1500);
  });

  it('pauses the model when the headers say the minute budget is spent', async () => {
    const { client } = setup([
      ok({}, { 'x-ratelimit-remaining-tokens': '10', 'x-ratelimit-reset-tokens': '7.66s' }),
      ok(),
    ]);
    const first = await client.chat(req, call);
    expect(first.rateLimit).toEqual({ remainingTokens: 10, resetTokensMs: 7660 });
    const onWait = vi.fn();
    await client.chat(req, { ...call, onWait });
    expect(onWait).toHaveBeenCalledTimes(1);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(7660);
  });
});

describe('GroqLimiter', () => {
  it('never lets reservations in a 60 s window exceed the TPM budget under 5 concurrent callers', async () => {
    const tpm = 10_000;
    const limiter = new GroqLimiter(redis, { tpm, rpm: 1000, dailyTokens: 0 }, now, prefix);
    const events: { t: number; tokens: number }[] = [];
    const worker = async (tokens: number) => {
      for (let i = 0; i < 4; i++) {
        for (;;) {
          const at = clock.t; // the limiter reads the clock when acquire is called
          const a = await limiter.acquire(MODEL, tokens);
          if (a.ok) {
            events.push({ t: at, tokens });
            break;
          }
          clock.t += Math.min(a.waitMs, 5000); // fake sleep
        }
      }
    };
    await Promise.all([4000, 3000, 2500, 3500, 4500].map(worker));
    expect(events).toHaveLength(20);
    for (const e of events) {
      const inWindow = events
        .filter((x) => x.t > e.t - 60_000 && x.t <= e.t)
        .reduce((n, x) => n + x.tokens, 0);
      expect(inWindow).toBeLessThanOrEqual(tpm);
    }
  });

  it('enforces the request rate and the daily token budget', async () => {
    const limiter = new GroqLimiter(
      redis,
      { tpm: 100_000, rpm: 2, dailyTokens: 5000 },
      now,
      prefix,
    );
    expect((await limiter.acquire(MODEL, 1000)).ok).toBe(true);
    expect((await limiter.acquire(MODEL, 1000)).ok).toBe(true);
    const third = await limiter.acquire(MODEL, 1000);
    expect(third.ok).toBe(false);
    expect(third).toMatchObject({ waitMs: 60_000 });
    clock.t += 61_000;
    expect((await limiter.acquire(MODEL, 1000)).ok).toBe(true);
    const daily = await limiter.acquire(MODEL, 3000);
    expect(daily).toMatchObject({ ok: false, daily: true });
  });

  it('settle replaces a reservation with the real cost', async () => {
    const limiter = new GroqLimiter(redis, { tpm: 100_000, rpm: 100, dailyTokens: 0 }, now, prefix);
    const a = await limiter.acquire(MODEL, 5000);
    if (!a.ok) throw new Error('expected a reservation');
    await limiter.settle(a.reservation, 1200);
    expect(await limiter.windowTokens(MODEL)).toBe(1200);
  });
});
