import type { Difficulty, InterviewLevel } from '@thegrave/shared';
import type { Pack } from './pack.js';
import type { CritiqueOutput, TriageOutput, WriterOutput } from './schemas.js';

// Two injectable layers (plan.md 6.10): LlmClient is the chat transport (GroqClient in production), InterviewLlm
// is the stage-level API the pipeline uses (GroqInterviewLlm in production, FakeInterviewLlm in tests).

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  responseFormat: { type: 'json_schema'; name: string; schema: object } | { type: 'json_object' };
  reasoningEffort?: 'low' | 'medium' | 'high';
  maxCompletionTokens: number;
}

export interface LlmUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number | null;
}

export interface ChatResult {
  content: string;
  finishReason: string;
  usage: LlmUsage;
  rateLimit: { remainingTokens?: number; resetTokensMs?: number; remainingRequests?: number };
}

export interface ChatCallOptions {
  signal: AbortSignal;
  timeoutMs: number;
  /** Prompt estimate + max completion tokens, reserved against the model's tokens-per-minute budget. */
  reserveTokens: number;
  /** Called once when the call has to wait for rate-limit capacity. */
  onWait?: (until: Date) => void;
  /** Epoch ms after which waiting is pointless (the job deadline); a longer wait fails with AI_BUSY. */
  deadline?: number;
}

/** Low-level chat transport. GroqClient is the only production implementation. */
export interface LlmClient {
  chat(req: ChatRequest, opts: ChatCallOptions): Promise<ChatResult>;
}

/** Minimal logger the pipeline needs; pino satisfies it. */
export interface InterviewLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

/** A reply that stayed invalid after the repair retry (or was cut off). Triage falls back, critique is skipped. */
export class LlmOutputError extends Error {
  constructor(
    readonly stage: 'triage' | 'write' | 'critique',
    readonly issues: string,
    /** What the failed attempts used, so spend is still recorded. */
    readonly usage: LlmUsage[] = [],
  ) {
    super(`${stage}: model output unusable (${issues})`);
    this.name = 'LlmOutputError';
  }
}

export type ConcreteLevel = Exclude<InterviewLevel, 'AUTO'>;

export interface TriageCandidate {
  path: string;
  lines: number;
  score: number;
  outline: string[];
}

export interface TriageInput {
  displayName: string;
  description: string | null;
  /** README excerpt, already cut to the tier's budget. */
  readme: string | null;
  profileLine: string;
  candidates: TriageCandidate[];
  maxFiles: number;
}

export interface WriteInput {
  level: ConcreteLevel;
  /** True when the user chose AUTO and the level was inferred. */
  levelInferred: boolean;
  /** Frozen description of the repository, identical across the calls that share a shard (prefix cache). */
  profileText: string;
  shard: Pack;
  shardIndex: number;
  shardCount: number;
  count: number;
  difficulties: Difficulty[];
  focusAreas: string[];
  /** One line per question accepted so far, so later shards and the top-up avoid repeats. */
  accepted: string[];
  /** Top-up only: what was rejected and why. */
  rejected: { question: string; reason: string }[];
  topUp: boolean;
  maxOut: number;
}

export interface CritiqueItem {
  index: number;
  question: string;
  category: string;
  difficulty: Difficulty;
  whyAsked: string;
  snippets: { path: string; startLine: number; endLine: number; code: string }[];
}

export interface CritiqueInput {
  level: ConcreteLevel;
  summary: string;
  items: CritiqueItem[];
}

/** Optional per-call context from the worker. */
export interface StageOptions {
  onWait?: (until: Date) => void;
  deadline?: number;
}

export interface StageResult<T> {
  data: T;
  /** One entry per underlying call: a repair or length retry makes a second one. */
  usage: LlmUsage[];
}

/** Stage-level API used by the pipeline. */
export interface InterviewLlm {
  triage(
    input: TriageInput,
    signal: AbortSignal,
    opts?: StageOptions,
  ): Promise<StageResult<TriageOutput>>;
  /** One shard. */
  write(
    input: WriteInput,
    signal: AbortSignal,
    opts?: StageOptions,
  ): Promise<StageResult<WriterOutput>>;
  critique(
    input: CritiqueInput,
    signal: AbortSignal,
    opts?: StageOptions,
  ): Promise<StageResult<CritiqueOutput>>;
}
