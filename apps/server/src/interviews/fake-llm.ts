import { INTERVIEW_CATEGORIES } from '@thegrave/shared';
import type { TierBudget } from './budget.js';
import type {
  ChatCallOptions,
  ChatMessage,
  ChatRequest,
  ChatResult,
  CritiqueInput,
  InterviewLlm,
  LlmClient,
  LlmUsage,
  StageResult,
  TriageInput,
  WriteInput,
} from './llm.js';
import {
  buildCritiqueMessages,
  buildTriageMessages,
  buildWriterMessages,
  estimateMessages,
} from './prompts.js';
import type { CritiqueOutput, TriageOutput, WriterOutput, WriterQuestion } from './schemas.js';

export interface FakeCall {
  stage: 'triage' | 'write' | 'critique';
  /** The exact messages a real client would have sent. */
  messages: ChatMessage[];
  /** Prompt estimate + the completion tokens the stage would reserve. */
  estimate: number;
  input: TriageInput | WriteInput | CritiqueInput;
}

function usageFor(estimate: number): LlmUsage[] {
  return [
    {
      model: 'fake',
      inputTokens: estimate,
      outputTokens: 100,
      cachedInputTokens: 0,
      reasoningTokens: null,
    },
  ];
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

interface Window {
  path: string;
  start: number;
  end: number;
  lines: string[];
}

/** 4-line windows of real, shown lines of one packed file (parsed back from its rendered "12| code" form). */
function windowsOf(file: { path: string; text: string }): Window[] {
  const numbered: { n: number; text: string }[] = [];
  for (const line of file.text.split('\n')) {
    const m = /^(\d+)\| ?(.*)$/.exec(line);
    if (m) numbered.push({ n: Number(m[1]), text: m[2]! });
  }
  const out: Window[] = [];
  for (let i = 0; i + 3 < numbered.length; i += 4) {
    const chunk = numbered.slice(i, i + 4);
    if (chunk[3]!.n - chunk[0]!.n !== 3) continue;
    if (
      chunk
        .map((c) => c.text)
        .join('')
        .trim().length < 20
    )
      continue;
    // import blocks look alike across files and would trip the duplicate check
    if (chunk.filter((c) => /^\s*(import|from)\b/.test(c.text)).length >= 2) continue;
    out.push({
      path: file.path,
      start: chunk[0]!.n,
      end: chunk[3]!.n,
      lines: chunk.map((c) => c.text),
    });
  }
  return out;
}

function makeQuestion(
  w: Window,
  k: number,
  difficulty: WriterQuestion['difficulty'],
  shardIndex: number,
): WriterQuestion {
  // Mostly code, little template: distinct windows must not look like duplicates of each other.
  const code = w.lines
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 220);
  return {
    category: INTERVIEW_CATEGORIES[(k + shardIndex * 3) % INTERVIEW_CATEGORIES.length]!,
    difficulty,
    question: `In ${baseName(w.path)} (lines ${w.start}-${w.end}), what breaks first in \`${code}\`?`,
    whyAsked: `Shows whether the author understands the failure behaviour of ${baseName(w.path)}.`,
    evidence: [
      { path: w.path, startLine: w.start, endLine: w.end, quote: w.lines.slice(0, 2).join('\n') },
    ],
    strongAnswer: [
      `Walks through what ${baseName(w.path)} does at lines ${w.start}-${w.end}`,
      'Names the failure mode and who observes it',
    ],
    followUps: ['How would you test that?', 'What would you log?'],
    redFlags: ['Cannot say what the code does when it fails'],
  };
}

/**
 * Deterministic stand-in for Groq: reads only its input. Writes grounded questions (quoting real shown lines)
 * plus three deliberately bad ones in the first shard so tests prove the verifier works; the critique keeps
 * everything except index 0. Records every call for assertions.
 */
export class FakeInterviewLlm implements InterviewLlm {
  readonly calls: FakeCall[] = [];

  constructor(private readonly budget: TierBudget) {}

  private record(
    stage: FakeCall['stage'],
    messages: ChatMessage[],
    maxOut: number,
    input: FakeCall['input'],
  ): number {
    const estimate = estimateMessages(messages) + maxOut;
    this.calls.push({ stage, messages, estimate, input });
    return estimate;
  }

  async triage(input: TriageInput): Promise<StageResult<TriageOutput>> {
    const estimate = this.record(
      'triage',
      buildTriageMessages(input),
      this.budget.triageMaxOut,
      input,
    );
    return {
      data: {
        summary: `${input.displayName} is a small project. It is used here as a deterministic fixture.`,
        apparentLevel: 'MID',
        focusAreas: ['error handling', 'data model'],
        files: input.candidates
          .slice(0, Math.min(10, input.maxFiles))
          .map((c) => ({ path: c.path, reason: 'central to the project' })),
      },
      usage: usageFor(estimate),
    };
  }

  async write(input: WriteInput): Promise<StageResult<WriterOutput>> {
    const estimate = this.record('write', buildWriterMessages(input), input.maxOut, input);
    const n = input.count >= 10 ? 12 : input.count;
    const perFile = input.shard.files.map(windowsOf);
    const questions: WriterQuestion[] = [];
    for (let round = 0; questions.length < n; round++) {
      let progressed = false;
      for (const windows of perFile) {
        const w = windows[round];
        if (!w || questions.length >= n) continue;
        progressed = true;
        const k = questions.length;
        questions.push(makeQuestion(w, k, input.difficulties[k] ?? 'MEDIUM', input.shardIndex));
      }
      if (!progressed) break;
    }

    const first = perFile.flat()[0];
    if (input.shardIndex === 0 && !input.topUp && first) {
      const good = makeQuestion(first, 0, 'MEDIUM', 0);
      questions.push(
        {
          ...good,
          question: `Why does ${baseName(first.path)} rely on the module in src/does/not/exist.ts rather than the existing code?`,
          evidence: [
            {
              path: 'src/does/not/exist.ts',
              startLine: 1,
              endLine: 3,
              quote: 'export const nothing = 1;',
            },
          ],
        },
        {
          ...good,
          question: `What would you change in ${baseName(first.path)} if its behaviour had to be made idempotent?`,
          evidence: [
            { ...good.evidence[0]!, quote: 'this text does not appear in the file at all' },
          ],
        },
        { ...good, question: `What is REST in ${baseName(first.path)}?` },
      );
    }
    return { data: { questions }, usage: usageFor(estimate) };
  }

  async critique(input: CritiqueInput): Promise<StageResult<CritiqueOutput>> {
    const estimate = this.record(
      'critique',
      buildCritiqueMessages(input),
      this.budget.critiqueMaxOut,
      input,
    );
    return {
      data: {
        reviews: input.items.map((item) => {
          const reject = item.index === 0;
          return {
            index: item.index,
            specificity: reject ? 2 : 5,
            groundedness: 5,
            levelFit: 'ok' as const,
            duplicateOf: null,
            verdict: reject ? ('reject' as const) : ('keep' as const),
            reason: reject ? 'Too vague for this code.' : 'Specific and grounded.',
            tightenedQuestion: null,
          };
        }),
      },
      usage: usageFor(estimate),
    };
  }
}

export type ScriptedStep =
  ChatResult | Error | ((req: ChatRequest, opts: ChatCallOptions) => ChatResult | Error);

/** A canned ChatResult for scripts. */
export function chatResult(
  content: string,
  extra: { finishReason?: string; model?: string; cached?: number } = {},
): ChatResult {
  return {
    content,
    finishReason: extra.finishReason ?? 'stop',
    usage: {
      model: extra.model ?? 'openai/gpt-oss-120b',
      inputTokens: 1000,
      outputTokens: 200,
      cachedInputTokens: extra.cached ?? 0,
      reasoningTokens: null,
    },
    rateLimit: {},
  };
}

/** Replays a queue of results and errors, to test GroqInterviewLlm's repair and retry logic without a network. */
export class ScriptedLlmClient implements LlmClient {
  readonly requests: { req: ChatRequest; opts: ChatCallOptions }[] = [];

  constructor(private readonly script: ScriptedStep[]) {}

  async chat(req: ChatRequest, opts: ChatCallOptions): Promise<ChatResult> {
    this.requests.push({ req, opts });
    const step = this.script.shift();
    if (step === undefined) throw new Error('ScriptedLlmClient: script exhausted');
    const out = typeof step === 'function' ? step(req, opts) : step;
    if (out instanceof Error) throw out;
    return out;
  }
}
