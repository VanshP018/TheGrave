import type { z } from 'zod';
import type { TierBudget } from './budget.js';
import { GroqApiError } from './groq-client.js';
import { InterviewError } from './errors.js';
import {
  LlmOutputError,
  type ChatMessage,
  type ChatRequest,
  type ChatResult,
  type CritiqueInput,
  type InterviewLlm,
  type InterviewLogger,
  type LlmClient,
  type LlmUsage,
  type StageOptions,
  type StageResult,
  type TriageInput,
  type WriteInput,
} from './llm.js';
import {
  CRITIQUE_FORMAT,
  TRIAGE_FORMAT,
  WRITER_FORMAT,
  buildCritiqueMessages,
  buildTriageMessages,
  buildWriterMessages,
  difficultyList,
  estimateMessages,
} from './prompts.js';
import {
  CRITIQUE_JSON_SCHEMA,
  CritiqueOutputSchema,
  STRICT_SCHEMA_MODELS,
  TRIAGE_JSON_SCHEMA,
  TriageOutputSchema,
  WRITER_JSON_SCHEMA,
  WriterOutputSchema,
  parseModelJson,
  type CritiqueOutput,
  type TriageOutput,
  type WriterOutput,
} from './schemas.js';

export type JsonMode = 'auto' | 'json_schema' | 'json_object';

export interface GroqInterviewLlmOptions {
  budget: TierBudget;
  models: { writer: string; triage: string; critique: string };
  jsonMode?: JsonMode;
  log?: InterviewLogger;
}

/** A truncated copy of a failed reply is echoed back in the repair prompt. */
const REPAIR_ECHO_TOKENS = 2000;

interface CallSpec<T> {
  stage: 'triage' | 'write' | 'critique';
  model: string;
  schemaName: string;
  jsonSchema: object;
  zod: z.ZodType<T>;
  /** Messages for the given system-prompt appendix ('' in strict mode). */
  build: (appendix: string) => ChatMessage[];
  appendix: string;
  effort: 'low' | 'medium' | 'high';
  maxOut: number;
  timeoutMs: number;
  /** A smaller request for a reply cut off by max_completion_tokens, or null. */
  shrink?: (appendix: string) => ChatMessage[] | null;
}

/** InterviewLlm on top of an LlmClient: prompts, structured-output mode, validation, repair and length retries. */
export class GroqInterviewLlm implements InterviewLlm {
  constructor(
    private readonly client: LlmClient,
    private readonly o: GroqInterviewLlmOptions,
  ) {}

  /** json_schema + strict for models that support it, json_object otherwise (or when forced). */
  private useJsonObject(model: string): boolean {
    const mode = this.o.jsonMode ?? 'auto';
    if (mode === 'json_object') return true;
    if (mode === 'json_schema') return false;
    return !STRICT_SCHEMA_MODELS.has(model);
  }

  triage(
    input: TriageInput,
    signal: AbortSignal,
    opts: StageOptions = {},
  ): Promise<StageResult<TriageOutput>> {
    const b = this.o.budget;
    return this.call(
      {
        stage: 'triage',
        model: this.o.models.triage,
        schemaName: 'repo_triage',
        jsonSchema: TRIAGE_JSON_SCHEMA,
        zod: TriageOutputSchema,
        build: (a) => buildTriageMessages(input, a),
        appendix: TRIAGE_FORMAT,
        effort: 'low',
        maxOut: b.triageMaxOut,
        timeoutMs: b.triageTimeoutMs,
      },
      signal,
      opts,
    );
  }

  async write(
    input: WriteInput,
    signal: AbortSignal,
    opts: StageOptions = {},
  ): Promise<StageResult<WriterOutput>> {
    const b = this.o.budget;
    const shrunk = input.count > 10 ? 10 : Math.min(3, input.count - 1);
    try {
      return await this.call(
        {
          stage: 'write',
          model: this.o.models.writer,
          schemaName: 'interview_questions',
          jsonSchema: WRITER_JSON_SCHEMA,
          zod: WriterOutputSchema,
          build: (a) => buildWriterMessages(input, a),
          appendix: WRITER_FORMAT,
          effort: b.writerEffort,
          maxOut: input.maxOut,
          timeoutMs: b.writerTimeoutMs,
          shrink:
            shrunk >= 1
              ? (a) =>
                  buildWriterMessages(
                    { ...input, count: shrunk, difficulties: difficultyList(input.level, shrunk) },
                    a,
                  )
              : undefined,
        },
        signal,
        opts,
      );
    } catch (err) {
      // An unusable reply costs this shard its questions, not the whole analysis.
      if (err instanceof LlmOutputError) {
        this.o.log?.warn({ stage: 'write', issues: err.issues }, 'writer_shard_empty');
        return { data: { questions: [] }, usage: err.usage };
      }
      throw err;
    }
  }

  critique(
    input: CritiqueInput,
    signal: AbortSignal,
    opts: StageOptions = {},
  ): Promise<StageResult<CritiqueOutput>> {
    const b = this.o.budget;
    return this.call(
      {
        stage: 'critique',
        model: this.o.models.critique,
        schemaName: 'question_review',
        jsonSchema: CRITIQUE_JSON_SCHEMA,
        zod: CritiqueOutputSchema,
        build: (a) => buildCritiqueMessages(input, a),
        appendix: CRITIQUE_FORMAT,
        effort: b.critiqueEffort,
        maxOut: b.critiqueMaxOut,
        timeoutMs: b.triageTimeoutMs,
      },
      signal,
      opts,
    );
  }

  private async call<T>(
    spec: CallSpec<T>,
    signal: AbortSignal,
    opts: StageOptions,
  ): Promise<StageResult<T>> {
    const { budget, log } = this.o;
    const jsonObject = this.useJsonObject(spec.model);
    const appendix = jsonObject ? spec.appendix : '';
    const usage: LlmUsage[] = [];
    const effort = spec.model.startsWith('openai/gpt-oss') ? spec.effort : undefined;

    // One request; a model-JSON 400 comes back as `failed` instead of throwing so the repair path can run.
    const send = async (
      messages: ChatMessage[],
    ): Promise<{ result: ChatResult } | { failed: GroqApiError }> => {
      const req: ChatRequest = {
        model: spec.model,
        messages,
        responseFormat: jsonObject
          ? { type: 'json_object' }
          : { type: 'json_schema', name: spec.schemaName, schema: spec.jsonSchema },
        maxCompletionTokens: spec.maxOut,
        ...(effort ? { reasoningEffort: effort } : {}),
      };
      try {
        const result = await this.client.chat(req, {
          signal,
          timeoutMs: spec.timeoutMs,
          reserveTokens: estimateMessages(messages) + spec.maxOut,
          onWait: opts.onWait,
          deadline: opts.deadline,
        });
        usage.push(result.usage);
        if (result.finishReason === 'content_filter') throw new InterviewError('AI_REFUSED');
        return { result };
      } catch (err) {
        if (err instanceof GroqApiError && err.jsonFailure) return { failed: err };
        throw err;
      }
    };
    const fits = (messages: ChatMessage[]) =>
      estimateMessages(messages) + spec.maxOut <= budget.maxRequestTokens;
    const unusable = (issues: string) => new LlmOutputError(spec.stage, issues, usage);

    let messages = spec.build(appendix);
    let first = await send(messages);

    if ('result' in first && first.result.finishReason === 'length') {
      const smaller = spec.shrink?.(appendix);
      if (!smaller || !fits(smaller)) throw unusable('reply cut off by max_completion_tokens');
      log?.warn({ stage: spec.stage }, 'llm_length_retry');
      messages = smaller;
      first = await send(messages);
      if ('result' in first && first.result.finishReason === 'length')
        throw unusable('reply cut off by max_completion_tokens');
    }

    let issues: string;
    let echo: string | null;
    if ('result' in first) {
      const parsed = parseModelJson(spec.zod, first.result.content);
      if (parsed.ok) return { data: parsed.data, usage };
      issues = parsed.issues;
      echo = first.result.content;
    } else {
      issues = first.failed.message;
      echo = first.failed.failedGeneration;
    }

    // One repair retry with the zod issues, only if it still fits the per-request cap.
    const repair: ChatMessage[] = [
      ...messages,
      ...(echo
        ? [{ role: 'assistant' as const, content: echo.slice(0, REPAIR_ECHO_TOKENS * 3.2) }]
        : []),
      {
        role: 'user',
        content: `Your reply did not match the required JSON schema: ${issues}. Reply with the corrected JSON object only.`,
      },
    ];
    if (!fits(repair)) throw unusable(issues);
    log?.warn({ stage: spec.stage, issues }, 'llm_repair_retry');
    const second = await send(repair);
    if ('failed' in second) throw unusable(second.failed.message);
    if (second.result.finishReason === 'length')
      throw unusable('reply cut off by max_completion_tokens');
    const parsed = parseModelJson(spec.zod, second.result.content);
    if (!parsed.ok) throw unusable(parsed.issues);
    return { data: parsed.data, usage };
  }
}
