import { InterviewError } from './errors.js';
import type {
  ChatCallOptions,
  ChatRequest,
  ChatResult,
  InterviewLogger,
  LlmClient,
} from './llm.js';
import { GroqLimiter, parseGroqDuration, type Reservation } from './rate-limit.js';

/** An HTTP error from Groq that the stage layer may still handle (a 400 for JSON the model failed to produce). */
export class GroqApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type: string | null,
    readonly code: string | null,
    /** What the model generated before the API rejected it, when Groq says so. */
    readonly failedGeneration: string | null,
    readonly jsonFailure: boolean,
  ) {
    super(message);
    this.name = 'GroqApiError';
  }
}

export interface GroqClientOptions {
  apiKey: string;
  /** e.g. https://api.groq.com/openai/v1 */
  baseUrl: string;
  limiter: GroqLimiter;
  fetch?: typeof fetch;
  /** Injectable so 429 and backoff paths run on a fake clock in tests. Use the same clock as the limiter. */
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  log?: InterviewLogger;
}

const MAX_SLICE_MS = 5000;
const MAX_429_TRIES = 4;
const MAX_SERVER_TRIES = 3;
/** A 429 asking for more than this is a daily limit, not a busy minute. */
const LONG_WAIT_MS = 10 * 60_000;
/** The longest retry-after we are willing to sleep through. */
const SHORT_WAIT_MS = 120_000;
const DAY_MS = 86_400_000;
const JSON_FAILURE =
  /json_validate_failed|generated json|does not match|invalid json|failed to generate json/i;

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

interface ErrorBody {
  message: string;
  type: string | null;
  code: string | null;
  failedGeneration: string | null;
}

function parseErrorBody(text: string): ErrorBody {
  try {
    const e = (JSON.parse(text) as { error?: Record<string, unknown> }).error ?? {};
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    return {
      message: str(e.message) ?? text.slice(0, 300),
      type: str(e.type),
      code: str(e.code),
      failedGeneration: str(e.failed_generation),
    };
  } catch {
    return { message: text.slice(0, 300), type: null, code: null, failedGeneration: null };
  }
}

function numHeader(h: Headers, name: string): number | undefined {
  const v = h.get(name);
  if (v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Plain-fetch Groq chat transport with Redis-backed rate limiting, header sync and the error table of plan.md 6.9.
 * Retries and waits are bounded; every give-up is an InterviewError except a model-JSON 400, which the stage layer
 * repairs (GroqApiError).
 */
export class GroqClient implements LlmClient {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly o: GroqClientOptions) {
    this.fetchFn = o.fetch ?? fetch;
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? abortableSleep;
    this.random = o.random ?? Math.random;
  }

  /** The request body. No reasoning_format, tools, streaming or temperature, ever (plan.md 6.6). */
  buildBody(req: ChatRequest): Record<string, unknown> {
    return {
      model: req.model,
      messages: req.messages,
      response_format:
        req.responseFormat.type === 'json_schema'
          ? {
              type: 'json_schema',
              json_schema: {
                name: req.responseFormat.name,
                strict: true,
                schema: req.responseFormat.schema,
              },
            }
          : { type: 'json_object' },
      ...(req.reasoningEffort
        ? { reasoning_effort: req.reasoningEffort, include_reasoning: false }
        : {}),
      max_completion_tokens: req.maxCompletionTokens,
      stream: false,
    };
  }

  async chat(req: ChatRequest, opts: ChatCallOptions): Promise<ChatResult> {
    const { limiter, log } = this.o;
    const exhausted = await limiter.exhaustedUntil(req.model);
    if (exhausted !== null && exhausted > this.now()) throw new InterviewError('AI_CAPACITY');

    const body = JSON.stringify(this.buildBody(req));
    let tries429 = 0;
    let triesServer = 0;
    let retried422 = false;

    for (;;) {
      if (opts.signal.aborted) throw new InterviewError('TIMEOUT');
      const reservation = await this.reserve(req.model, opts);
      const started = this.now();

      let res: Response;
      let text: string;
      try {
        res = await this.fetchFn(`${this.o.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.o.apiKey}` },
          body,
          signal: AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs)]),
        });
        text = await res.text();
      } catch (err) {
        await limiter.settle(reservation, 0);
        if (opts.signal.aborted) throw new InterviewError('TIMEOUT');
        if ((err as Error).name === 'TimeoutError')
          throw new InterviewError('AI_UNAVAILABLE', undefined, { retryable: true });
        log?.warn({ model: req.model, err: String(err) }, 'groq_network_error');
        await this.backoffServer(++triesServer, opts);
        continue;
      }

      const rl = this.readRateLimit(res.headers);
      await this.syncHeaders(req.model, rl, res.headers, opts.reserveTokens);

      if (res.ok) {
        let json: {
          choices?: { message?: { content?: string | null }; finish_reason?: string }[];
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
            completion_tokens_details?: { reasoning_tokens?: number };
          };
        };
        try {
          json = JSON.parse(text);
        } catch {
          await limiter.settle(reservation, 0);
          await this.backoffServer(++triesServer, opts);
          continue;
        }
        const u = json.usage ?? {};
        const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
        const input = u.prompt_tokens ?? 0;
        const output = u.completion_tokens ?? 0;
        await limiter.settle(reservation, input - cached + output);
        const choice = json.choices?.[0];
        log?.info(
          {
            model: req.model,
            estimate: opts.reserveTokens,
            promptTokens: input,
            cachedTokens: cached,
            completionTokens: output,
            ms: this.now() - started,
          },
          'groq_call',
        );
        return {
          content: choice?.message?.content ?? '',
          finishReason: choice?.finish_reason ?? 'stop',
          usage: {
            model: req.model,
            inputTokens: input,
            outputTokens: output,
            cachedInputTokens: cached,
            reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? null,
          },
          rateLimit: rl,
        };
      }

      const err = parseErrorBody(text);
      const status = res.status;

      if (status === 429) {
        // the reservation stays counted: Groq may already have charged it
        const retryAfter = numHeader(res.headers, 'retry-after');
        const retryAfterMs = retryAfter === undefined ? null : Math.ceil(retryAfter * 1000);
        const daily = /per day|\bTPD\b|\bRPD\b/i.test(err.message);
        if ((retryAfterMs !== null && retryAfterMs > LONG_WAIT_MS) || daily) {
          const wait = retryAfterMs ?? DAY_MS - (this.now() % DAY_MS);
          await limiter.markExhausted(req.model, wait);
          log?.warn({ model: req.model, waitMs: wait }, 'groq_daily_limit');
          throw new InterviewError('AI_CAPACITY');
        }
        const wait =
          (retryAfterMs ??
            parseGroqDuration(res.headers.get('x-ratelimit-reset-tokens')) ??
            2000 * 2 ** tries429) + Math.floor(this.random() * 1000);
        const retryAt = new Date(this.now() + wait);
        tries429++;
        if (
          (retryAfterMs !== null && retryAfterMs > SHORT_WAIT_MS) ||
          tries429 >= MAX_429_TRIES ||
          (opts.deadline !== undefined && this.now() + wait + opts.timeoutMs > opts.deadline)
        )
          throw new InterviewError('AI_BUSY', undefined, { retryable: true, retryAt });
        await limiter.pause(req.model, this.now() + wait);
        continue;
      }

      await limiter.settle(reservation, 0);

      if (status === 413) {
        log?.warn({ model: req.model, estimate: opts.reserveTokens }, 'budget_misconfigured');
        throw new InterviewError('AI_UNAVAILABLE');
      }
      if (status === 400 && JSON_FAILURE.test(`${err.code ?? ''} ${err.message}`))
        throw new GroqApiError(status, err.message, err.type, err.code, err.failedGeneration, true);
      if (status === 422 && !retried422) {
        retried422 = true;
        continue;
      }
      if (status === 498 || status >= 500) {
        await this.backoffServer(++triesServer, opts);
        continue;
      }
      // other 400, 401, 403, 404, repeated 422: misconfiguration, never retried
      log?.warn({ model: req.model, status, message: err.message }, 'groq_request_rejected');
      throw new InterviewError('AI_UNAVAILABLE');
    }
  }

  private async backoffServer(tries: number, opts: ChatCallOptions): Promise<void> {
    if (tries >= MAX_SERVER_TRIES)
      throw new InterviewError('AI_UNAVAILABLE', undefined, { retryable: true });
    const wait = 2000 * 2 ** (tries - 1) + Math.floor(this.random() * 1000);
    if (opts.deadline !== undefined && this.now() + wait + opts.timeoutMs > opts.deadline)
      throw new InterviewError('AI_UNAVAILABLE', undefined, { retryable: true });
    try {
      await this.sleep(wait, opts.signal);
    } catch {
      throw new InterviewError('TIMEOUT');
    }
  }

  /** Wait (in short, abortable slices) until the limiter grants the reservation. */
  private async reserve(model: string, opts: ChatCallOptions): Promise<Reservation> {
    let notified = false;
    for (;;) {
      const a = await this.o.limiter.acquire(model, opts.reserveTokens);
      if (a.ok) return a.reservation;
      if ('daily' in a) {
        await this.o.limiter.markExhausted(model, a.waitMs);
        throw new InterviewError('AI_CAPACITY');
      }
      const until = this.now() + a.waitMs;
      if (opts.deadline !== undefined && until + opts.timeoutMs > opts.deadline)
        throw new InterviewError('AI_BUSY', undefined, {
          retryable: true,
          retryAt: new Date(until),
        });
      if (!notified) {
        notified = true;
        opts.onWait?.(new Date(until));
      }
      try {
        await this.sleep(Math.min(a.waitMs, MAX_SLICE_MS), opts.signal);
      } catch {
        throw new InterviewError('TIMEOUT');
      }
    }
  }

  private readRateLimit(h: Headers): ChatResult['rateLimit'] {
    const out: ChatResult['rateLimit'] = {};
    const remainingTokens = numHeader(h, 'x-ratelimit-remaining-tokens');
    const resetTokensMs = parseGroqDuration(h.get('x-ratelimit-reset-tokens'));
    const remainingRequests = numHeader(h, 'x-ratelimit-remaining-requests');
    if (remainingTokens !== undefined) out.remainingTokens = remainingTokens;
    if (resetTokensMs !== null) out.resetTokensMs = resetTokensMs;
    if (remainingRequests !== undefined) out.remainingRequests = remainingRequests;
    return out;
  }

  /** Header sync: pause when the minute's tokens are spent; flag the day when requests-per-day hit zero. */
  private async syncHeaders(
    model: string,
    rl: ChatResult['rateLimit'],
    h: Headers,
    typicalNext: number,
  ): Promise<void> {
    const { limiter } = this.o;
    if (
      rl.remainingTokens !== undefined &&
      rl.resetTokensMs !== undefined &&
      rl.remainingTokens < typicalNext
    )
      await limiter.pause(model, this.now() + rl.resetTokensMs);
    if (rl.remainingRequests === 0) {
      const reset = parseGroqDuration(h.get('x-ratelimit-reset-requests')) ?? DAY_MS;
      await limiter.markExhausted(model, reset);
    }
  }
}
