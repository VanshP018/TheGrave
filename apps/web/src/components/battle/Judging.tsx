import type { SubmissionView, TestResultView } from '@thegrave/shared';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { VERDICT_LABEL, verdictTone } from './format';

/** The submission the console is following: the one just sent (animated) or, after a reload, the latest. */
export interface JudgeState {
  id: string;
  sub: SubmissionView | null;
  /** Reveal the verdicts one by one (and celebrate). False for a submission restored after a reload. */
  animate: boolean;
}

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      className={`block shrink-0 rounded-full border-2 border-ash-600 border-t-azure motion-safe:animate-spin ${className}`}
      aria-hidden
    />
  );
}

/** Filled status disc: a check for accepted, a cross for anything else. Pops in when revealed. */
function StatusDot({ ok, className = 'h-4 w-4' }: { ok: boolean; className?: string }) {
  return (
    <motion.svg
      viewBox="0 0 20 20"
      className={`shrink-0 ${className}`}
      initial={{ scale: 0.3, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 18 }}
      aria-hidden
    >
      <circle cx="10" cy="10" r="10" className={ok ? 'fill-emerald-500' : 'fill-red-500'} />
      <path
        d={ok ? 'M6 10.4l2.6 2.6L14 7.6' : 'M7 7l6 6M13 7l-6 6'}
        fill="none"
        stroke="#0a0a0a"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </motion.svg>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ash-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

/**
 * "Last submission": a card per hidden test that spins while the judge works, then flips to pass/fail one
 * after another once the verdict lands (the judge reports all tests at once; the stagger is presentation).
 * `onRevealed` fires once every card has flipped (animated submissions only).
 */
export function LastSubmission(props: {
  judge: JudgeState;
  total: number | null;
  onRevealed: (sub: SubmissionView) => void;
}) {
  const { judge, total, onRevealed } = props;
  const { sub, animate } = judge;
  const reduceMotion = useReducedMotion();
  const done = sub?.status === 'DONE';
  const tests: TestResultView[] = done ? sub.tests : [];
  const [revealed, setRevealed] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const revealedCb = useRef(onRevealed);
  revealedCb.current = onRevealed;

  useEffect(() => {
    if (!sub || (sub.status !== 'DONE' && sub.status !== 'FAILED')) return;
    const n = sub.tests.length;
    if (!animate || reduceMotion || n === 0) {
      setRevealed(n);
      // A restored submission is old news: no celebration.
      if (animate) revealedCb.current(sub);
      return;
    }
    // About a second for the whole sweep, however many tests there are.
    const step = Math.min(160, Math.max(60, 1100 / n));
    let i = 0;
    const t = setInterval(() => {
      setRevealed(++i);
      if (i >= n) {
        clearInterval(t);
        revealedCb.current(sub);
      }
    }, step);
    return () => clearInterval(t);
    // Re-run only when the judging finishes, not on every poll.
  }, [sub?.id, sub?.status]);

  const settled = !!sub && (sub.status === 'FAILED' || (done && revealed >= tests.length));
  const count = done ? tests.length : (total ?? 0);
  const shown = tests.slice(0, revealed);
  const passed = shown.filter((t) => t.verdict === 'ACCEPTED').length;
  const accepted = settled && done && sub.verdict === 'ACCEPTED';
  const firstFail = tests.findIndex((t) => t.verdict !== 'ACCEPTED');
  const selected = picked ?? (settled ? Math.max(0, firstFail) : null);
  const current = selected !== null && selected < revealed ? tests[selected] : undefined;

  const status = !sub || sub.status === 'QUEUED' ? 'In queue' : !settled ? 'Running tests' : null;

  return (
    <section aria-label="Last submission" className="space-y-3">
      {/* ---- Summary: tests passed | verdict --------------------------------------------------- */}
      <div
        className={`relative grid grid-cols-2 overflow-hidden rounded-md border transition-colors duration-500 ${
          accepted ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'border-ash-700 bg-hero-bg/60'
        }`}
      >
        <div className="flex flex-col items-center justify-center gap-0.5 border-r border-ash-700 px-3 py-3">
          <p className="font-mono text-2xl font-semibold tabular-nums text-ink">
            {sub?.status === 'FAILED' ? '–' : done || revealed ? passed : '–'}
            <span className="text-ash-400">/{count || '?'}</span>
          </p>
          <p className="text-xs text-ash-300">Test cases passed</p>
        </div>
        <div
          className="flex flex-col items-center justify-center gap-1.5 px-3 py-3"
          role="status"
          aria-live="polite"
        >
          {status ? (
            <>
              <Spinner className="h-5 w-5" />
              <p className="text-sm font-medium text-ash-300">{status}</p>
            </>
          ) : sub!.status === 'FAILED' ? (
            <p className="text-sm font-medium text-orange-400">Judge error, submit again</p>
          ) : (
            <>
              <StatusDot ok={accepted} className="h-5 w-5" />
              <p className={`text-sm font-semibold ${verdictTone(sub!.verdict)}`}>
                {sub!.compileOutput ? 'Compile error' : VERDICT_LABEL[sub!.verdict!]}
              </p>
            </>
          )}
        </div>
        {/* Sweep progress along the bottom edge. */}
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-ash-800">
          <div
            className={`h-full transition-[width] duration-150 ease-out ${
              settled ? (accepted ? 'bg-emerald-400' : 'bg-red-400') : 'bg-azure'
            }`}
            style={{ width: `${count ? (revealed / count) * 100 : 0}%` }}
          />
        </div>
      </div>

      {sub?.compileOutput ? (
        <pre className="max-h-40 overflow-auto rounded-md border border-ash-700 bg-hero-bg/60 px-3 py-2 font-mono text-[13px] leading-6 text-red-300">
          {sub.compileOutput}
        </pre>
      ) : (
        count > 0 && (
          <div className="grid gap-3 rounded-md border border-ash-700 bg-hero-bg/60 p-2 sm:grid-cols-[1fr_15rem]">
            <ul
              className="grid content-start grid-cols-[repeat(auto-fill,minmax(5.75rem,1fr))] gap-1"
              aria-label="Test cases"
            >
              {Array.from({ length: count }, (_, i) => {
                const t = i < revealed ? tests[i] : undefined;
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => setPicked(i)}
                      disabled={!t}
                      aria-pressed={selected === i}
                      aria-label={`Test ${i + 1}: ${t ? VERDICT_LABEL[t.verdict] : 'judging'}`}
                      className={`flex h-9 w-full items-center justify-between gap-2 rounded-md px-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors enabled:cursor-pointer ${
                        selected === i
                          ? 'bg-ash-700 text-ink'
                          : 'text-ash-300 enabled:hover:bg-ash-800 enabled:hover:text-ink'
                      }`}
                    >
                      TC #{i + 1}
                      {t ? <StatusDot ok={t.verdict === 'ACCEPTED'} /> : <Spinner />}
                    </button>
                  </li>
                );
              })}
            </ul>
            <dl className="grid content-start grid-cols-2 gap-x-4 gap-y-2.5 border-t border-ash-800 px-2 pb-1 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-1">
              {current ? (
                <>
                  <Field label="Input">
                    <span className="text-ash-400">Hidden</span>
                  </Field>
                  <Field label="Output">
                    <span className="text-ash-400">Hidden</span>
                  </Field>
                  <Field label="Status">
                    <span className={verdictTone(current.verdict)}>
                      {VERDICT_LABEL[current.verdict]}
                    </span>
                  </Field>
                  <Field label="Time">
                    <span className="font-mono">{current.timeMs} ms</span>
                  </Field>
                </>
              ) : (
                <p className="col-span-2 py-2 text-xs text-ash-400">
                  {settled ? 'Pick a test case.' : 'Waiting for the judge…'}
                </p>
              )}
            </dl>
          </div>
        )
      )}
    </section>
  );
}
