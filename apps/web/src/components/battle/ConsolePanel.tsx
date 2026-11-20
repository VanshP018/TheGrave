import type { BattleView, SubmissionView } from '@thegrave/shared';
import { useState, type ReactNode } from 'react';
import { LastSubmission, type JudgeState } from './Judging';
import { LANGUAGE_LABEL } from './ProblemPanel';
import { ago, VERDICT_LABEL, verdictTone } from './format';

export type ConsoleTab = 'results' | 'submissions' | 'errors';

const TABS: { id: ConsoleTab; label: string }[] = [
  { id: 'results', label: 'Test results' },
  { id: 'submissions', label: 'Submissions' },
  { id: 'errors', label: 'Errors' },
];

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="grid h-full min-h-24 place-items-center px-4 text-center text-sm text-ash-400">
      {children}
    </p>
  );
}

function Block({ label, text, tone = 'text-ink' }: { label: string; text: string; tone?: string }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ash-400">{label}</p>
      <pre
        className={`max-h-40 overflow-auto rounded-md border border-ash-700 bg-hero-bg/60 px-3 py-2 font-mono text-[13px] leading-6 ${tone}`}
      >
        {text || ' '}
      </pre>
    </div>
  );
}

/** Sample-run results, LeetCode-style: an overall verdict, one chip per case, the selected case's I/O. */
export function Results({ run, running }: { run: SubmissionView | null; running: boolean }) {
  const [caseIdx, setCaseIdx] = useState(0);
  if (running) return <Empty>Running your code against the samples…</Empty>;
  if (!run) return <Empty>Run your code to test it against the examples. (Ctrl/⌘ + Enter)</Empty>;
  if (run.status === 'FAILED')
    return (
      <Empty>
        <span className="text-orange-400">The judge failed, try again.</span>
      </Empty>
    );

  const allPassed = run.testsPassed === run.testsTotal;
  const first = run.tests.find((t) => t.verdict !== 'ACCEPTED') ?? run.tests[0];
  const headline = run.compileOutput
    ? 'Compile error'
    : allPassed
      ? 'Accepted'
      : VERDICT_LABEL[first?.verdict ?? 'WRONG_ANSWER'];
  const t = run.tests[Math.min(caseIdx, run.tests.length - 1)];

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p
          className={`text-lg font-semibold ${allPassed && !run.compileOutput ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {headline}
        </p>
        <p className="text-xs text-ash-400">
          {run.testsPassed ?? 0}/{run.testsTotal ?? run.tests.length} samples passed
          {run.maxTimeMs !== null && ` · ${run.maxTimeMs} ms`}
        </p>
      </div>

      {run.compileOutput ? (
        <Block label="Compiler output" text={run.compileOutput} tone="text-red-300" />
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Sample cases">
            {run.tests.map((c, i) => (
              <button
                key={c.index}
                role="tab"
                aria-selected={i === caseIdx}
                onClick={() => setCaseIdx(i)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  i === caseIdx
                    ? 'bg-ash-700 text-ink'
                    : 'text-ash-300 hover:bg-ash-800 hover:text-ink'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${c.verdict === 'ACCEPTED' ? 'bg-emerald-400' : 'bg-red-400'}`}
                  aria-hidden
                />
                Case {c.index + 1}
              </button>
            ))}
          </div>
          {t && (
            <div className="space-y-3">
              <p className={`text-xs font-medium ${verdictTone(t.verdict)}`}>
                {VERDICT_LABEL[t.verdict]} · {t.timeMs} ms
              </p>
              {t.input !== undefined && <Block label="Input" text={t.input} />}
              {t.stdout !== undefined && (
                <Block
                  label="Your output"
                  text={t.stdout}
                  tone={t.verdict === 'ACCEPTED' ? 'text-ink' : 'text-red-300'}
                />
              )}
              {t.stderr?.trim() && <Block label="Error" text={t.stderr} tone="text-red-300" />}
              {t.expected !== undefined && <Block label="Expected" text={t.expected} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Submissions(props: {
  view: BattleView;
  now: number;
  judge: JudgeState | null;
  onRevealed: (sub: SubmissionView) => void;
}) {
  const { view, now, judge, onRevealed } = props;
  if (!view.mySubmissions.length && !judge)
    return (
      <Empty>
        Submitted solutions are judged against every hidden test. (Ctrl/⌘ + Shift + Enter)
      </Empty>
    );
  return (
    <div className="space-y-4 p-4">
      {judge && (
        <LastSubmission
          key={judge.id}
          judge={judge}
          total={view.totalTests}
          onRevealed={onRevealed}
        />
      )}
      {view.mySubmissions.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-ash-400">
            All submissions
          </p>
          <ul
            className="divide-y divide-ash-800"
            aria-label="Your submissions"
            data-testid="my-submissions"
          >
            {[...view.mySubmissions].reverse().map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span
                  className={`min-w-0 flex-1 truncate font-medium ${verdictTone(s.status === 'DONE' ? s.verdict : null)}`}
                >
                  {s.status === 'DONE'
                    ? VERDICT_LABEL[s.verdict!]
                    : s.status === 'FAILED'
                      ? 'Judge error'
                      : 'Judging…'}
                </span>
                <span className="font-mono text-xs tabular-nums text-ink">
                  {s.testsPassed ?? '–'}/{s.testsTotal ?? view.totalTests}
                </span>
                <span className="hidden w-20 text-xs text-ash-400 sm:block">
                  {s.language === 'node' ? 'Node.js' : LANGUAGE_LABEL[s.language]}
                </span>
                <span className="w-16 text-right text-xs text-ash-400">
                  {ago(s.createdAt, now)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Errors({ run }: { run: SubmissionView | null }) {
  const stderr = run?.tests.filter((t) => t.stderr?.trim()) ?? [];
  if (!run?.compileOutput && !stderr.length) return <Empty>No errors from your last run.</Empty>;
  return (
    <div className="space-y-3 p-4">
      {run?.compileOutput && (
        <Block label="Compiler output" text={run.compileOutput} tone="text-red-300" />
      )}
      {stderr.map((t) => (
        <Block
          key={t.index}
          label={`Case ${t.index + 1} · stderr`}
          text={t.stderr!}
          tone="text-red-300"
        />
      ))}
    </div>
  );
}

/** Bottom panel under the editor: run results, this match's submissions, and errors. */
export function ConsolePanel(props: {
  tab: ConsoleTab;
  onTab: (t: ConsoleTab) => void;
  run: SubmissionView | null;
  running: boolean;
  view: BattleView;
  now: number;
  message: string | null;
  judge: JudgeState | null;
  onRevealed: (sub: SubmissionView) => void;
}) {
  const { tab, onTab, run, running, view, now, message, judge, onRevealed } = props;
  const errorCount =
    (run?.compileOutput ? 1 : 0) + (run?.tests.filter((t) => t.stderr?.trim()).length ?? 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex shrink-0 items-center border-b border-ash-700 px-2"
        role="tablist"
        aria-label="Console"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onTab(t.id)}
            className={`relative flex h-10 cursor-pointer items-center gap-1.5 px-3 text-[11px] font-medium uppercase tracking-widest transition-colors ${
              tab === t.id
                ? 'text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-azure'
                : 'text-ash-400 hover:text-ink'
            }`}
          >
            {t.label}
            {t.id === 'submissions' && view.mySubmissions.length > 0 && (
              <span className="rounded-sm bg-ash-700 px-1 text-[10px] tracking-normal text-ash-300">
                {view.mySubmissions.length}
              </span>
            )}
            {t.id === 'errors' && errorCount > 0 && (
              <span className="rounded-sm bg-red-500/15 px-1 text-[10px] tracking-normal text-red-400">
                {errorCount}
              </span>
            )}
          </button>
        ))}
        {message && (
          <p className="ml-auto truncate pl-3 pr-2 text-xs text-ash-300" role="status">
            {message}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {/* All tabs stay mounted, so a judging sweep keeps going (and finishes) on another tab. */}
        <div hidden={tab !== 'results'} className="h-full">
          <Results key={run?.id} run={run} running={running} />
        </div>
        <div hidden={tab !== 'submissions'} className="h-full">
          <Submissions view={view} now={now} judge={judge} onRevealed={onRevealed} />
        </div>
        <div hidden={tab !== 'errors'} className="h-full">
          <Errors run={run} />
        </div>
      </div>
    </div>
  );
}
