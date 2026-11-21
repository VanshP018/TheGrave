import type {
  InterviewLevel,
  InterviewQuestionView,
  InterviewStage,
  RepoRef,
} from '@thegrave/shared';
import type { TierBudget } from './budget.js';
import { InterviewError } from './errors.js';
import {
  LlmOutputError,
  type ConcreteLevel,
  type CritiqueItem,
  type InterviewLlm,
  type InterviewLogger,
  type LlmUsage,
  type StageOptions,
  type WriteInput,
} from './llm.js';
import { packFiles, shardPack, type PackInput } from './pack.js';
import { isManifest, profileRepo, type RepoProfile } from './profile.js';
import {
  buildCritiqueBatches,
  buildProfileText,
  buildTriageInput,
  dealDifficulties,
  difficultyList,
} from './prompts.js';
import type { RepoMeta, RepoSource } from './source.js';
import {
  buildSourceIndex,
  extractDependencies,
  textStillValid,
  verifyQuestions,
  type Rejection,
  type SourceIndex,
  type VerifiedQuestion,
} from './verify.js';

export interface PipelineDeps {
  source: RepoSource;
  llm: InterviewLlm;
  budget: TierBudget;
  log?: InterviewLogger;
  onStage(stage: InterviewStage, detail: string): void;
  /** Called when an LLM call has to wait for rate-limit capacity; the worker shows a countdown. */
  onWait?(until: Date): void;
  now?: () => number;
}

export interface PipelineMetrics {
  redactions: number;
  filesProfiled: number;
  filesPacked: number;
  shards: number;
  written: number;
  verified: number;
  rejectedByReason: Record<string, number>;
  critiqueRejected: number;
  critiqueSkipped: boolean;
  triageFallback: boolean;
  topUp: boolean;
}

export interface PipelineResult {
  meta: RepoMeta;
  profile: RepoProfile;
  apparentLevel: ConcreteLevel;
  summary: string;
  focusAreas: string[];
  questions: InterviewQuestionView[];
  usage: LlmUsage[];
  rejections: Rejection[];
  metrics: PipelineMetrics;
}

/** Fewer accepted questions than this triggers the (developer tier) top-up. */
const TARGET_MIN = 8;
const TARGET_MAX = 10;
const MIN_ACCEPTED = 5;
const TOPUP_MAX_OUT = 8000;
const TOPUP_MIN_TIME_MS = 60_000;

interface Reviewed {
  keep: VerifiedQuestion[];
  /** Kept, but the reviewer thought the level was off: used only to reach TARGET_MIN. */
  loose: VerifiedQuestion[];
  rejected: number;
  skipped: boolean;
}

function concreteLevel(l: InterviewLevel): ConcreteLevel {
  return l === 'AUTO' ? 'JUNIOR' : l;
}

function orderQuestions(qs: VerifiedQuestion[]): VerifiedQuestion[] {
  const out: VerifiedQuestion[] = [];
  for (const d of ['EASY', 'MEDIUM', 'HARD'] as const) {
    const byCat = new Map<string, VerifiedQuestion[]>();
    for (const q of qs.filter((x) => x.difficulty === d)) {
      byCat.set(q.category, [...(byCat.get(q.category) ?? []), q]);
    }
    const queues = [...byCat.values()];
    while (queues.some((q) => q.length > 0))
      for (const q of queues) if (q.length > 0) out.push(q.shift()!);
  }
  return out;
}

function numbered(index: SourceIndex, path: string, from: number, to: number): string {
  const file = index.get(path);
  if (!file) return '';
  const a = Math.max(1, from);
  const b = Math.min(file.lines.length, to);
  const out: string[] = [];
  for (let n = a; n <= b; n++) out.push(`${n}| ${file.lines[n - 1]}`);
  return out.join('\n');
}

/**
 * The whole analysis, from repository to verified questions, without Postgres or a queue (plan.md 6.11).
 * Throws InterviewError; AI_BUSY and the other LLM errors from the writer propagate, while a failing triage or
 * critique degrades gracefully.
 */
export async function runPipeline(
  deps: PipelineDeps,
  ref: RepoRef,
  requestedLevel: InterviewLevel,
  signal: AbortSignal,
): Promise<PipelineResult> {
  const { source, llm, budget, log } = deps;
  const now = deps.now ?? Date.now;
  const deadline = now() + budget.jobTimeoutMs;
  const stageOpts: StageOptions = { onWait: deps.onWait, deadline };
  const usage: LlmUsage[] = [];
  const alive = () => {
    if (signal.aborted) throw new InterviewError('TIMEOUT');
  };

  // S1 + S2a
  deps.onStage('FETCHING', 'Reading repository metadata');
  const meta = await source.resolve(ref, signal);
  alive();
  deps.onStage('READING', 'Reading source files');
  const profile = await profileRepo(source, meta, signal);
  alive();

  // S2b: triage, with a heuristic fallback
  const triageInput = buildTriageInput(profile, budget);
  const byScore = [...profile.files].sort(
    (a, b) => b.finalScore - a.finalScore || a.path.localeCompare(b.path),
  );
  let triagePaths: string[];
  let summary = '';
  let focusAreas: string[] = [];
  let level: ConcreteLevel;
  let triageFallback = false;
  try {
    const r = await llm.triage(triageInput, signal, stageOpts);
    usage.push(...r.usage);
    const allowed = new Set(triageInput.candidates.map((c) => c.path));
    triagePaths = [...new Set(r.data.files.map((f) => f.path.trim().replace(/^\.\//, '')))]
      .filter((p) => allowed.has(p))
      .slice(0, budget.maxFiles);
    if (triagePaths.length < Math.min(MIN_ACCEPTED, allowed.size))
      throw new Error('too few valid triage paths');
    summary = r.data.summary.trim();
    focusAreas = r.data.focusAreas.slice(0, 5);
    level = r.data.apparentLevel;
  } catch (err) {
    alive();
    if (err instanceof LlmOutputError) usage.push(...err.usage);
    triageFallback = true;
    log?.warn({ err: String(err) }, 'triage_fallback');
    triagePaths = byScore.slice(0, budget.maxFiles).map((f) => f.path);
    summary = `${profile.displayName}${profile.description ? `: ${profile.description}` : ' is a code repository.'}`;
    level = concreteLevel(profile.apparentLevel);
  }
  const levelInferred = requestedLevel === 'AUTO';
  const concrete: ConcreteLevel = requestedLevel === 'AUTO' ? level : requestedLevel;

  // S2c: pack (manifest first, then triage order) and shards
  const texts = new Map(profile.files.map((f) => [f.path, f.text]));
  const manifest = profile.files
    .filter((f) => isManifest(f.path))
    .sort(
      (a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path),
    )[0];
  const order = [
    ...(manifest ? [manifest.path] : []),
    ...triagePaths.filter((p) => p !== manifest?.path),
  ];
  const inputs: PackInput[] = order.map((path) => ({ path, text: texts.get(path)! }));
  const pack = packFiles(inputs, budget);
  if (pack.files.length === 0) throw new InterviewError('NO_SOURCE_FILES');
  const shards = shardPack(pack, budget);
  const index = buildSourceIndex(pack, texts);
  const dependencies = extractDependencies(
    profile.files.filter((f) => isManifest(f.path)).map((f) => ({ path: f.path, text: f.text })),
  );
  const vctx = { index, dependencies };
  const profileText = buildProfileText(profile, summary);

  // S3 + S4a: write shard by shard (the limiter paces them), verifying as we go
  const total = budget.questionsPerCall * shards.length;
  const dealt = dealDifficulties(difficultyList(concrete, total), shards.length);
  const verified: VerifiedQuestion[] = [];
  const rejections: Rejection[] = [];
  let written = 0;
  let refused = 0;
  const writeInput = (i: number, extra: Partial<WriteInput> = {}): WriteInput => ({
    level: concrete,
    levelInferred,
    profileText,
    shard: shards[i]!,
    shardIndex: i,
    shardCount: shards.length,
    count: budget.questionsPerCall,
    difficulties: dealt[i]!,
    focusAreas,
    accepted: verified.map((q) => q.question),
    rejected: [],
    topUp: false,
    maxOut: budget.writerMaxOut,
    ...extra,
  });

  for (let i = 0; i < shards.length; i++) {
    deps.onStage('WRITING', `Writing questions (${i + 1}/${shards.length})`);
    try {
      const r = await llm.write(writeInput(i), signal, stageOpts);
      usage.push(...r.usage);
      written += r.data.questions.length;
      const v = verifyQuestions(r.data.questions, vctx, verified);
      verified.push(...v.accepted);
      rejections.push(...v.rejected);
    } catch (err) {
      if (err instanceof InterviewError && err.code === 'AI_REFUSED') {
        refused++;
        continue;
      }
      throw err;
    }
  }
  if (refused === shards.length) throw new InterviewError('AI_REFUSED');

  // S4b: critique
  deps.onStage('REVIEWING', 'Reviewing questions');
  const ctxLines = budget.tier === 'developer' ? 5 : 2;
  let critiqueRejected = 0;

  const review = async (questions: VerifiedQuestion[]): Promise<Reviewed> => {
    const items: CritiqueItem[] = questions.map((q, i) => ({
      index: i,
      question: q.question,
      category: q.category,
      difficulty: q.difficulty,
      whyAsked: q.whyAsked,
      snippets: q.evidence.map((e) => ({
        path: e.path,
        startLine: e.startLine,
        endLine: e.endLine,
        code: numbered(index, e.path, e.startLine - ctxLines, e.endLine + ctxLines),
      })),
    }));
    const batches = buildCritiqueBatches(concrete, summary, items, budget);
    const reviews = new Map<number, import('./schemas.js').CritiqueOutput['reviews'][number]>();
    const unchecked = new Set<number>();
    let skipped = false;
    for (const batch of batches) {
      try {
        const r = await llm.critique(batch, signal, stageOpts);
        usage.push(...r.usage);
        for (const rv of r.data.reviews) if (!reviews.has(rv.index)) reviews.set(rv.index, rv);
      } catch (err) {
        alive();
        if (err instanceof LlmOutputError) usage.push(...err.usage);
        skipped = true;
        for (const it of batch.items) unchecked.add(it.index);
        log?.warn({ err: String(err) }, 'critique_skipped');
      }
    }
    const keep: VerifiedQuestion[] = [];
    const loose: VerifiedQuestion[] = [];
    let rejected = 0;
    questions.forEach((q, i) => {
      if (unchecked.has(i)) return void keep.push(q); // critique failed: the grounded question stands
      const rv = reviews.get(i);
      const scoreOk = (n: number) => Number.isInteger(n) && n >= 4 && n <= 5;
      const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 5;
      if (
        !rv ||
        !valid(rv.specificity) ||
        !valid(rv.groundedness) ||
        rv.verdict !== 'keep' ||
        !scoreOk(rv.specificity) ||
        !scoreOk(rv.groundedness) ||
        rv.duplicateOf !== null
      ) {
        rejected++;
        return;
      }
      let out = q;
      const tight = rv.tightenedQuestion?.trim();
      if (tight && textStillValid(tight, q, dependencies)) out = { ...q, question: tight };
      (rv.levelFit === 'ok' ? keep : loose).push(out);
    });
    return { keep, loose, rejected, skipped };
  };

  const first = await review(verified);
  let critiqueSkipped = first.skipped;
  critiqueRejected += first.rejected;
  let keep = [...first.keep];
  let loose = [...first.loose];
  const enough = () => keep.length + loose.length >= TARGET_MIN;

  // S4c: top-up once (developer tier), with the identical system + repo prefix so Groq's cache can serve it
  let topUp = false;
  if (budget.topUp && !enough() && deadline - now() >= TOPUP_MIN_TIME_MS) {
    topUp = true;
    deps.onStage('WRITING', 'Writing a few more questions');
    try {
      const have = keep.length + loose.length;
      const count = TARGET_MAX - have;
      const r = await llm.write(
        writeInput(0, {
          topUp: true,
          count,
          difficulties: difficultyList(concrete, count),
          maxOut: Math.min(TOPUP_MAX_OUT, budget.writerMaxOut),
          accepted: [...keep, ...loose].map((q) => q.question),
          rejected: rejections
            .slice(0, 12)
            .map((x) => ({ question: x.question, reason: x.reason })),
        }),
        signal,
        stageOpts,
      );
      usage.push(...r.usage);
      written += r.data.questions.length;
      const v = verifyQuestions(r.data.questions, vctx, verified);
      verified.push(...v.accepted);
      rejections.push(...v.rejected);
      deps.onStage('REVIEWING', 'Reviewing new questions');
      const more = await review(v.accepted);
      critiqueSkipped ||= more.skipped;
      critiqueRejected += more.rejected;
      keep = [...keep, ...more.keep];
      loose = [...loose, ...more.loose];
    } catch (err) {
      alive();
      log?.warn({ err: String(err) }, 'topup_failed');
    }
  }

  // Final set: level-fit questions first, off-level ones only to reach the minimum, at most TARGET_MAX.
  const chosen = [...keep, ...loose.slice(0, Math.max(0, TARGET_MIN - keep.length))].slice(
    0,
    TARGET_MAX,
  );
  if (chosen.length < MIN_ACCEPTED) throw new InterviewError('TOO_FEW_QUESTIONS');
  const questions: InterviewQuestionView[] = orderQuestions(chosen).map((q, position) => ({
    position,
    category: q.category,
    difficulty: q.difficulty,
    question: q.question,
    whyAsked: q.whyAsked,
    evidence: q.evidence,
    strongAnswer: q.strongAnswer,
    followUps: q.followUps,
    redFlags: q.redFlags,
  }));

  const rejectedByReason: Record<string, number> = {};
  for (const r of rejections) rejectedByReason[r.reason] = (rejectedByReason[r.reason] ?? 0) + 1;
  return {
    meta,
    profile,
    apparentLevel: concrete,
    summary,
    focusAreas,
    questions,
    usage,
    rejections,
    metrics: {
      redactions: profile.redactions,
      filesProfiled: profile.files.length,
      filesPacked: pack.files.length,
      shards: shards.length,
      written,
      verified: verified.length,
      rejectedByReason,
      critiqueRejected,
      critiqueSkipped,
      triageFallback,
      topUp,
    },
  };
}
