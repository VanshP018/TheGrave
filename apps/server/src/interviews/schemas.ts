import { z } from 'zod';
import { INTERVIEW_CATEGORIES } from '@thegrave/shared';

// zod is the source of truth for every LLM output; `toGroqJsonSchema` derives the strict JSON schema from it
// (plan.md 6.6a). All fields are required and nothing is optional, which is what Groq's strict mode demands.
// Length and count limits live in verify.ts, not here (Groq documents only a JSON Schema subset).

const LEVELS = ['INTERN', 'JUNIOR', 'MID', 'SENIOR'] as const;

export const TriageOutputSchema = z.object({
  summary: z.string(),
  apparentLevel: z.enum(LEVELS),
  focusAreas: z.array(z.string()),
  files: z.array(z.object({ path: z.string(), reason: z.string() })),
});
export type TriageOutput = z.infer<typeof TriageOutputSchema>;

const Evidence = z.object({
  path: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  quote: z.string(),
});
const Question = z.object({
  category: z.enum(INTERVIEW_CATEGORIES),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  question: z.string(),
  whyAsked: z.string(),
  evidence: z.array(Evidence),
  strongAnswer: z.array(z.string()),
  followUps: z.array(z.string()),
  redFlags: z.array(z.string()),
});
export const WriterOutputSchema = z.object({ questions: z.array(Question) });
export type WriterOutput = z.infer<typeof WriterOutputSchema>;
export type WriterQuestion = z.infer<typeof Question>;

export const CritiqueOutputSchema = z.object({
  reviews: z.array(
    z.object({
      index: z.number().int(),
      specificity: z.number().int(),
      groundedness: z.number().int(),
      levelFit: z.enum(['ok', 'too_easy', 'too_hard']),
      duplicateOf: z.number().int().nullable(),
      verdict: z.enum(['keep', 'reject']),
      reason: z.string(),
      tightenedQuestion: z.string().nullable(),
    }),
  ),
});
export type CritiqueOutput = z.infer<typeof CritiqueOutputSchema>;

/** Models Groq documents strict `json_schema` support for (checked 2026-11-21). */
export const STRICT_SCHEMA_MODELS: ReadonlySet<string> = new Set([
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
  'meta-models/muse-spark-open',
]);

/** Keywords Groq's strict mode does not document; stripped so a valid schema is never rejected over one. */
const STRIPPED = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
  'format',
  'default',
]);
const SAFE_INT = Number.MAX_SAFE_INTEGER;

type Json = Record<string, unknown>;

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (node === null || typeof node !== 'object') return node;
  const src = node as Json;
  const out: Json = {};
  for (const [k, v] of Object.entries(src)) {
    if (STRIPPED.has(k)) continue;
    // zod emits the safe-integer range for .int(); it carries no information.
    if ((k === 'minimum' && v === -SAFE_INT) || (k === 'maximum' && v === SAFE_INT)) continue;
    out[k] = strictify(v);
  }
  if (out.properties && typeof out.properties === 'object') {
    out.required = Object.keys(out.properties as Json);
    out.additionalProperties = false;
  }
  // anyOf [T, null] => type [T, "null"] for simple T
  const any = out.anyOf;
  if (Array.isArray(any) && any.length === 2) {
    const nul = any.find((a) => (a as Json).type === 'null') as Json | undefined;
    const other = any.find((a) => a !== nul) as Json | undefined;
    if (nul && other && typeof other.type === 'string' && Object.keys(other).length === 1) {
      delete out.anyOf;
      out.type = [other.type, 'null'];
    }
  }
  return out;
}

/** JSON schema for Groq structured outputs, derived from a zod schema. */
export function toGroqJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return strictify(z.toJSONSchema(schema)) as Record<string, unknown>;
}

export const TRIAGE_JSON_SCHEMA = toGroqJsonSchema(TriageOutputSchema);
export const WRITER_JSON_SCHEMA = toGroqJsonSchema(WriterOutputSchema);
export const CRITIQUE_JSON_SCHEMA = toGroqJsonSchema(CritiqueOutputSchema);

/** Up to 5 `path: message` lines from a zod error, for the repair prompt. */
export function zodIssuesText(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; issues: string };

/** JSON.parse + zod validation of a model reply (always done, even in strict mode). */
export function parseModelJson<T>(schema: z.ZodType<T>, content: string): ParseResult<T> {
  let text = content.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence) text = fence[1]!;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, issues: `invalid JSON: ${(err as Error).message}`.slice(0, 200) };
  }
  const res = schema.safeParse(raw);
  return res.success
    ? { ok: true, data: res.data }
    : { ok: false, issues: zodIssuesText(res.error) };
}
