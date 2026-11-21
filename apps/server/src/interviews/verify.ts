import type { Difficulty, InterviewCategory, InterviewEvidence } from '@thegrave/shared';
import type { Pack } from './pack.js';
import { REDACTED } from './redact.js';
import type { WriterQuestion } from './schemas.js';

// Programmatic verification (plan.md 6.7). Runs before any critique, so the model never grades its own
// citations: a question survives only if the code it cites exists, says what the quote says, and is relevant.

export type RejectReason =
  | 'BAD_SHAPE'
  | 'UNKNOWN_PATH'
  | 'BAD_LINES'
  | 'QUOTE_MISMATCH'
  | 'NOT_ANCHORED'
  | 'GENERIC'
  | 'DUPLICATE';

export interface VerifiedQuestion {
  category: InterviewCategory;
  difficulty: Difficulty;
  question: string;
  whyAsked: string;
  /** Snippets are the server's own copy of the cited lines. */
  evidence: InterviewEvidence[];
  strongAnswer: string[];
  followUps: string[];
  redFlags: string[];
}

export interface Rejection {
  reason: RejectReason;
  question: string;
}

/** The redacted source of each packed file, with the line ranges the model was actually shown. */
export type SourceIndex = Map<string, { lines: string[]; shown: [number, number][] }>;

export function buildSourceIndex(pack: Pack, texts: Map<string, string>): SourceIndex {
  const index: SourceIndex = new Map();
  for (const f of pack.files) {
    const text = texts.get(f.path);
    if (text !== undefined) index.set(f.path, { lines: text.split('\n'), shown: f.shownRanges });
  }
  return index;
}

const MAX_EVIDENCE_LINES = 15;
const STOPWORDS = new Set(
  'this that with from return const function export import class true false null undefined else then when what which while have will your they their there been were also into over only some than them these those'.split(
    ' ',
  ),
);

function normalizePath(p: string): string {
  return p.trim().replace(/^\.\//, '');
}

function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

/** Strip a copied "12| " prefix, collapse whitespace and ignore redaction markers. */
function normQuote(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*\d+\|\s?/, ''))
    .join(' ')
    .replaceAll(REDACTED, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normSource(text: string): string {
  return text.replaceAll(REDACTED, '').replace(/\s+/g, ' ').trim();
}

function quoteMatches(quote: string, window: string): boolean {
  const q = normQuote(quote);
  if (!q) return false;
  const w = normSource(window);
  if (w.includes(q)) return true;
  // Looser retry: at least 80% of the quote's tokens appear in the window, in order.
  const qt = q.split(' ');
  const wt = w.split(' ');
  let j = 0;
  let hit = 0;
  for (const t of qt) {
    const at = wt.indexOf(t, j);
    if (at >= 0) {
      hit++;
      j = at + 1;
    }
  }
  return hit / qt.length >= 0.8;
}

function identifiers(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z_][A-Za-z0-9_]{3,}/g)) {
    if (!STOPWORDS.has(m[0].toLowerCase())) out.add(m[0]);
  }
  return out;
}

function hasWord(text: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_])${esc}(?![A-Za-z0-9_])`).test(text);
}

/** Dependency names declared by the manifests, so a question about "express" counts as anchored. */
export function extractDependencies(manifests: { path: string; text: string }[]): string[] {
  const out = new Set<string>();
  for (const m of manifests) {
    const name = basename(m.path);
    if (name === 'package.json') {
      try {
        const json = JSON.parse(m.text) as Record<string, unknown>;
        for (const key of ['dependencies', 'devDependencies', 'peerDependencies'])
          for (const dep of Object.keys((json[key] as object | undefined) ?? {})) out.add(dep);
      } catch {
        /* not valid JSON: no dependencies */
      }
    } else if (/^requirements.*\.txt$/.test(name)) {
      for (const line of m.text.split('\n')) {
        const dep = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line)?.[1];
        if (dep) out.add(dep);
      }
    } else if (name === 'go.mod') {
      for (const dep of m.text.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]+\/[^\s]+)\s+v/gm))
        out.add(dep[1]!);
    } else if (name === 'Cargo.toml' || name === 'pyproject.toml') {
      for (const dep of m.text.matchAll(/^\s*([A-Za-z0-9_-]{3,})\s*=\s*["{]/gm)) out.add(dep[1]!);
    }
  }
  return [...out].filter((d) => d.length >= 3);
}

export interface VerifyContext {
  index: SourceIndex;
  dependencies: string[];
}

const BANNED: RegExp[] = [
  /^\s*what (?:is|are) (?:a |an |the )?\s*[\w .-]{1,30}\?$/i,
  /\btell me about (?:yourself|this project)\b/i,
  /\bwhat are (?:the )?(?:benefits|advantages|pros and cons) of\b/i,
  /\bbest practices\b/i,
  /\bin general\b/i,
  /\bhow does (?:react|node(?:\.js)?|python|java|docker|kubernetes|git) work\b/i,
  /\bwhat is your (?:favorite|favourite)\b/i,
];
const DIFFERENCE = /\bexplain the difference between\b/i;

/** Rule 5: the text names the file, an identifier from the cited lines, or a declared dependency. */
export function isAnchored(
  text: string,
  evidence: { path: string; snippet: string }[],
  dependencies: string[],
): boolean {
  if (evidence.some((e) => text.includes(basename(e.path)))) return true;
  for (const e of evidence)
    for (const id of identifiers(e.snippet)) if (hasWord(text, id)) return true;
  return dependencies.some((d) => hasWord(text, d));
}

function anchoredIdentifiers(text: string, evidence: { snippet: string }[]): number {
  const found = new Set<string>();
  for (const e of evidence)
    for (const id of identifiers(e.snippet)) if (hasWord(text, id)) found.add(id);
  return found.size;
}

/** Rule 6: banned generic patterns. */
export function isGeneric(
  question: string,
  evidence: { path: string; snippet: string }[],
): boolean {
  if (BANNED.some((re) => re.test(question))) return true;
  // A textbook comparison only passes when it names two identifiers from the cited code.
  if (DIFFERENCE.test(question) && anchoredIdentifiers(question, evidence) < 2) return true;
  return false;
}

/** Rules 1 (text part), 5 and 6 again, for a critique's tightened wording. */
export function textStillValid(
  text: string,
  q: Pick<VerifiedQuestion, 'whyAsked' | 'evidence'>,
  dependencies: string[],
): boolean {
  const t = text.trim();
  if (t.length < 20 || t.length > 500) return false;
  if (!isAnchored(`${t} ${q.whyAsked}`, q.evidence, dependencies)) return false;
  return !isGeneric(t, q.evidence);
}

function trigrams(text: string): Set<string> {
  const s = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  const x = trigrams(a);
  const y = trigrams(b);
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both);
}

function rangeOverlap(a: InterviewEvidence, b: InterviewEvidence): number {
  if (a.path !== b.path) return 0;
  const inter = Math.min(a.endLine, b.endLine) - Math.max(a.startLine, b.startLine) + 1;
  if (inter <= 0) return 0;
  return inter / Math.min(a.endLine - a.startLine + 1, b.endLine - b.startLine + 1);
}

export function isDuplicate(a: VerifiedQuestion, b: VerifiedQuestion): boolean {
  if (trigramSimilarity(a.question, b.question) >= 0.6) return true;
  return (
    a.category === b.category &&
    a.evidence.some((x) => b.evidence.some((y) => rangeOverlap(x, y) >= 0.5))
  );
}

function shapeOk(q: WriterQuestion): boolean {
  const within = (xs: string[], min: number, max: number) =>
    xs.length >= min && xs.length <= max && xs.every((x) => x.trim().length > 0 && x.length <= 300);
  return (
    q.question.trim().length >= 20 &&
    q.question.length <= 500 &&
    q.whyAsked.length <= 300 &&
    q.evidence.length >= 1 &&
    q.evidence.length <= 3 &&
    within(q.strongAnswer, 2, 6) &&
    within(q.followUps, 1, 4) &&
    within(q.redFlags, 0, 4)
  );
}

function checkEvidence(
  q: WriterQuestion,
  ctx: VerifyContext,
): { reason: RejectReason } | { evidence: InterviewEvidence[] } {
  const evidence: InterviewEvidence[] = [];
  for (const e of q.evidence) {
    const path = normalizePath(e.path);
    const file = ctx.index.get(path);
    if (!file) return { reason: 'UNKNOWN_PATH' };
    const { startLine, endLine } = e;
    const inShown = file.shown.some(([a, b]) => startLine >= a && endLine <= b);
    if (
      !Number.isInteger(startLine) ||
      !Number.isInteger(endLine) ||
      startLine < 1 ||
      endLine < startLine ||
      endLine - startLine > MAX_EVIDENCE_LINES - 1 ||
      endLine > file.lines.length ||
      !inShown
    )
      return { reason: 'BAD_LINES' };
    const window = file.lines.slice(Math.max(0, startLine - 3), endLine + 2).join('\n');
    if (!quoteMatches(e.quote, window)) return { reason: 'QUOTE_MISMATCH' };
    evidence.push({
      path,
      startLine,
      endLine,
      snippet: file.lines.slice(startLine - 1, endLine).join('\n'),
    });
  }
  return { evidence };
}

/**
 * Verify generated questions against the pack. `accepted` are questions already kept (earlier shards), so
 * duplicates are caught across shards too. Returns the new survivors and every rejection with its reason.
 */
export function verifyQuestions(
  questions: WriterQuestion[],
  ctx: VerifyContext,
  accepted: VerifiedQuestion[] = [],
): { accepted: VerifiedQuestion[]; rejected: Rejection[] } {
  const kept: VerifiedQuestion[] = [];
  const rejected: Rejection[] = [];
  for (const q of questions) {
    const reject = (reason: RejectReason) => rejected.push({ reason, question: q.question });
    if (!shapeOk(q)) {
      reject('BAD_SHAPE');
      continue;
    }
    const ev = checkEvidence(q, ctx);
    if ('reason' in ev) {
      reject(ev.reason);
      continue;
    }
    const text = q.question.trim();
    if (!isAnchored(`${text} ${q.whyAsked}`, ev.evidence, ctx.dependencies)) {
      reject('NOT_ANCHORED');
      continue;
    }
    if (isGeneric(text, ev.evidence)) {
      reject('GENERIC');
      continue;
    }
    const vq: VerifiedQuestion = {
      category: q.category,
      difficulty: q.difficulty,
      question: text,
      whyAsked: q.whyAsked.trim(),
      evidence: ev.evidence,
      strongAnswer: q.strongAnswer.map((s) => s.trim()),
      followUps: q.followUps.map((s) => s.trim()),
      redFlags: q.redFlags.map((s) => s.trim()),
    };
    if ([...accepted, ...kept].some((other) => isDuplicate(vq, other))) {
      reject('DUPLICATE');
      continue;
    }
    kept.push(vq);
  }
  return { accepted: kept, rejected };
}
