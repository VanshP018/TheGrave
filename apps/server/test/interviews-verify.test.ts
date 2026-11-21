import { beforeAll, describe, expect, it } from 'vitest';
import type { WriterQuestion } from '../src/interviews/schemas.js';
import {
  extractDependencies,
  trigramSimilarity,
  verifyQuestions,
  type SourceIndex,
} from '../src/interviews/verify.js';
import { expressApi, type FixtureRepo } from './fixtures/interview-repos.js';
import { prepare } from './fixtures/interview-setup.js';

let index: SourceIndex;
let dependencies: string[];
let omittedLine: { path: string; line: number };
const PATH = 'src/routes/orders.js';

function lines(path: string, a: number, b: number): string[] {
  return index.get(path)!.lines.slice(a - 1, b);
}

function question(over: Partial<WriterQuestion> = {}, a = 7, b = 11): WriterQuestion {
  return {
    category: 'BUG_RISK',
    difficulty: 'MEDIUM',
    question:
      'In orders.js the POST handler enqueues the order after Order.create; what happens if enqueue fails after the order was stored?',
    whyAsked: 'Shows whether they considered partial failure in the orders route.',
    evidence: [
      { path: PATH, startLine: a, endLine: b, quote: lines(PATH, a, b).slice(0, 2).join('\n') },
    ],
    strongAnswer: ['Order is stored but never processed', 'Needs an outbox or a retry'],
    followUps: ['How would you detect stuck orders?'],
    redFlags: ['Assumes enqueue cannot fail'],
    ...over,
  };
}

const verify = (qs: WriterQuestion[], accepted = []) =>
  verifyQuestions(qs, { index, dependencies }, accepted);

beforeAll(async () => {
  const p = await prepare(expressApi, 'developer');
  index = p.index;
  dependencies = extractDependencies(
    p.profile.files
      .filter((f) => f.path === 'package.json')
      .map((f) => ({ path: f.path, text: f.text })),
  );
  // A long file packed on the free tier has omitted windows.
  const long: FixtureRepo = {
    'package.json': '{ "name": "long" }',
    'src/big.js': Array.from(
      { length: 260 },
      (_, i) =>
        `export function handler${i}(x) { if (x > ${i} && x < ${i + 9}) { return ${i}; } return x; }`,
    ).join('\n'),
  };
  const free = await prepare(long, 'free');
  const f = free.pack.files.find((x) => x.path === 'src/big.js')!;
  const gap = f.shownRanges[0]![1] + 1;
  omittedLine = { path: 'src/big.js', line: gap + 2 };
  index = new Map([...index, ...free.index]);
  expect(f.shownRanges.some(([a, b]) => omittedLine.line >= a && omittedLine.line <= b)).toBe(
    false,
  );
});

describe('verifyQuestions', () => {
  it('accepts a grounded question and stores the server copy of the lines', () => {
    const q = question();
    q.evidence[0]!.quote = '  const { sku, qty }   =  req.body;'; // whitespace differs
    q.evidence[0]!.startLine = 8;
    q.evidence[0]!.endLine = 9;
    const r = verify([q]);
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]!.evidence[0]!.snippet).toBe(lines(PATH, 8, 9).join('\n'));
  });

  it('accepts a quote copied with its "12| " line-number prefixes', () => {
    const ls = lines(PATH, 8, 9);
    const quote = ls.map((l, i) => `${8 + i}| ${l}`).join('\n');
    const r = verify([question({ evidence: [{ path: PATH, startLine: 8, endLine: 9, quote }] })]);
    expect(r.rejected).toEqual([]);
  });

  it('accepts a leading ./ on the path', () => {
    const q = question();
    q.evidence[0]!.path = `./${PATH}`;
    expect(verify([q]).accepted[0]!.evidence[0]!.path).toBe(PATH);
  });

  it.each([
    ['BAD_SHAPE', () => question({ question: 'Why?' })],
    ['BAD_SHAPE', () => question({ evidence: [] })],
    ['BAD_SHAPE', () => question({ strongAnswer: ['only one'] })],
    [
      'UNKNOWN_PATH',
      () => question({ evidence: [{ path: 'src/nope.js', startLine: 1, endLine: 2, quote: 'x' }] }),
    ],
    ['BAD_LINES', () => question({}, 0, 3)],
    ['BAD_LINES', () => question({}, 5, 5 + 15)],
    ['BAD_LINES', () => question({}, 500, 503)],
    [
      'QUOTE_MISMATCH',
      () =>
        question({
          evidence: [{ path: PATH, startLine: 8, endLine: 9, quote: 'totally invented code here' }],
        }),
    ],
    [
      'NOT_ANCHORED',
      () =>
        question({ question: 'What would you do differently about retries and failure handling?' }),
    ],
    [
      'GENERIC',
      () =>
        question({
          question: 'What are the benefits of Express, as used in orders.js, in general?',
        }),
    ],
    ['GENERIC', () => question({ question: 'What is REST in orders.js?' })],
    [
      'GENERIC',
      () =>
        question({
          question: 'Can you explain the difference between a Map and an Object in orders.js?',
        }),
    ],
  ] as const)('rejects %s', (reason, make) => {
    const r = verify([make()]);
    expect(r.accepted).toEqual([]);
    expect(r.rejected[0]!.reason).toBe(reason);
  });

  it('rejects a range inside an omitted window of a windowed file', () => {
    const { path, line } = omittedLine;
    const r = verify([
      question({
        evidence: [
          { path, startLine: line, endLine: line + 1, quote: index.get(path)!.lines[line - 1]! },
        ],
      }),
    ]);
    expect(r.rejected[0]!.reason).toBe('BAD_LINES');
  });

  it('anchors a question on a declared dependency', () => {
    expect(dependencies).toContain('express');
    const r = verify([
      question({
        question:
          'Why did you pick express here, and how does the router handle failed order creation?',
      }),
    ]);
    expect(r.rejected).toEqual([]);
  });

  it('dedupes within a batch and across shards', () => {
    const a = question();
    const twin = question({
      question:
        'In orders.js the POST handler enqueues the order after Order.create; what happens if enqueue fails after the order was saved?',
    });
    const first = verify([a, twin]);
    expect(first.accepted).toHaveLength(1);
    expect(first.rejected[0]!.reason).toBe('DUPLICATE');

    // a later shard repeating an accepted question is a duplicate too
    const later = verify([twin], first.accepted as never);
    expect(later.rejected[0]!.reason).toBe('DUPLICATE');

    // same category over the same lines also conflicts, whatever the wording
    const sameLines = question({
      question:
        'Which concurrency problem could appear between the order insert and the queue push in orders.js?',
    });
    expect(verify([sameLines], first.accepted as never).rejected[0]!.reason).toBe('DUPLICATE');
    // a different category on other lines is fine
    const other = question(
      {
        category: 'TESTING',
        question: 'How would you test the port check in server.js when no port is passed?',
      },
      8,
      8,
    );
    other.evidence[0]!.startLine = 8;
    other.evidence[0]!.endLine = 8;
    other.evidence[0]!.quote = lines(PATH, 8, 8)[0]!;
    const sep = verifyQuestions(
      [
        {
          ...other,
          evidence: [
            {
              ...other.evidence[0]!,
              path: 'src/server.js',
              startLine: 9,
              endLine: 10,
              quote: lines('src/server.js', 9, 10).join('\n'),
            },
          ],
        },
      ],
      { index, dependencies },
      first.accepted,
    );
    expect(sep.rejected).toEqual([]);
  });

  it('measures trigram similarity', () => {
    expect(trigramSimilarity('abcdef', 'abcdef')).toBe(1);
    expect(trigramSimilarity('abcdef', 'uvwxyz')).toBe(0);
  });
});
