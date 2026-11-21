import { describe, expect, it } from 'vitest';
import {
  CRITIQUE_JSON_SCHEMA,
  STRICT_SCHEMA_MODELS,
  TRIAGE_JSON_SCHEMA,
  WRITER_JSON_SCHEMA,
  WriterOutputSchema,
  parseModelJson,
  toGroqJsonSchema,
} from '../src/interviews/schemas.js';
import { z } from 'zod';

type Json = Record<string, unknown>;
const BANNED = ['$schema', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'format'];

function walk(node: unknown, visit: (n: Json) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (node === null || typeof node !== 'object') return;
  visit(node as Json);
  for (const v of Object.values(node)) walk(v, visit);
}

describe.each([
  ['triage', TRIAGE_JSON_SCHEMA],
  ['writer', WRITER_JSON_SCHEMA],
  ['critique', CRITIQUE_JSON_SCHEMA],
])('%s JSON schema', (_name, schema) => {
  it('is strict: no extra properties, everything required, no undocumented keywords', () => {
    let objects = 0;
    walk(schema, (n) => {
      for (const k of BANNED) expect(n).not.toHaveProperty(k);
      if (n.properties) {
        objects++;
        expect(n.additionalProperties).toBe(false);
        expect([...(n.required as string[])].sort()).toEqual(
          Object.keys(n.properties as Json).sort(),
        );
      }
    });
    expect(objects).toBeGreaterThan(1);
  });
});

describe('toGroqJsonSchema', () => {
  it('turns nullable fields into type unions', () => {
    const props = (
      (CRITIQUE_JSON_SCHEMA.properties as Json).reviews as { items: { properties: Json } }
    ).items.properties;
    expect(props.duplicateOf).toEqual({ type: ['integer', 'null'] });
    expect(props.tightenedQuestion).toEqual({ type: ['string', 'null'] });
  });

  it('strips length keywords and safe-integer bounds', () => {
    const s = toGroqJsonSchema(z.object({ a: z.string().min(2).max(9), b: z.number().int() }));
    expect(s).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'integer' } },
      required: ['a', 'b'],
      additionalProperties: false,
    });
  });

  it('lists the documented strict-mode models', () => {
    expect(STRICT_SCHEMA_MODELS.has('openai/gpt-oss-120b')).toBe(true);
    expect(STRICT_SCHEMA_MODELS.has('llama-3.3-70b-versatile')).toBe(false);
  });
});

describe('parseModelJson', () => {
  it('accepts valid output, tolerating a code fence', () => {
    const r = parseModelJson(WriterOutputSchema, '```json\n{"questions":[]}\n```');
    expect(r).toEqual({ ok: true, data: { questions: [] } });
  });

  it('reports invalid JSON and schema issues', () => {
    expect(parseModelJson(WriterOutputSchema, 'nope')).toMatchObject({ ok: false });
    const r = parseModelJson(WriterOutputSchema, '{"questions":[{"category":"X"}]}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toContain('questions.0.category');
  });
});
