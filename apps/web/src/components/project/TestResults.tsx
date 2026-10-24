import type { ProjectRunView } from '@thegrave/shared';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

const TONE = { pass: 'text-emerald-400', fail: 'text-red-400', error: 'text-orange-400' } as const;
const LABEL = { pass: 'Passed', fail: 'Failed', error: 'Error' } as const;

function Dot({ status }: { status: 'pass' | 'fail' | 'error' }) {
  return (
    <motion.svg
      viewBox="0 0 20 20"
      className="h-4 w-4 shrink-0"
      initial={{ scale: 0.3, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 18 }}
      aria-hidden
    >
      <circle
        cx="10"
        cy="10"
        r="10"
        className={
          status === 'pass'
            ? 'fill-emerald-500'
            : status === 'fail'
              ? 'fill-red-500'
              : 'fill-orange-500'
        }
      />
      <path
        d={
          status === 'pass'
            ? 'M6 10.4l2.6 2.6L14 7.6'
            : status === 'fail'
              ? 'M7 7l6 6M13 7l-6 6'
              : 'M10 5.5v5.5M10 14v.5'
        }
        fill="none"
        stroke="#0a0a0a"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </motion.svg>
  );
}

/**
 * Results of a TEST or SUBMIT run. A submission is revealed one test at a time (the grader reports all at
 * once; the stagger is presentation, like the DSA judge's D-058) and `onAllPassed` fires once it is done.
 */
export function TestResults(props: {
  run: ProjectRunView | null;
  pending: boolean;
  kind: 'TEST' | 'SUBMIT';
  expected: number | null;
  onAllPassed?: () => void;
}) {
  const { run, pending, kind, expected, onAllPassed } = props;
  const reduceMotion = useReducedMotion();
  const [revealed, setRevealed] = useState(0);
  const [showLog, setShowLog] = useState(false);
  const cb = useRef(onAllPassed);
  cb.current = onAllPassed;

  const results = run?.results ?? [];
  const total = run?.total ?? expected ?? 0;
  useEffect(() => {
    if (!run || run.status !== 'DONE') return;
    const allPassed = run.total !== null && run.passed === run.total && run.total > 0;
    if (kind === 'TEST' || reduceMotion || !results.length) {
      setRevealed(results.length);
      if (allPassed) cb.current?.();
      return;
    }
    setRevealed(0);
    let i = 0;
    const step = Math.min(160, Math.max(60, 1100 / results.length));
    const t = setInterval(() => {
      setRevealed(++i);
      if (i >= results.length) {
        clearInterval(t);
        if (allPassed) cb.current?.();
      }
    }, step);
    return () => clearInterval(t);
    // Only when a new run lands.
  }, [run?.id, run?.status]);

  if (!run && !pending)
    return (
      <p className="grid h-full min-h-24 place-items-center px-4 text-center text-sm text-ash-400">
        {kind === 'TEST'
          ? 'Run the visible tests in tests/ (Ctrl/⌘ + Enter).'
          : 'Submit to grade your fix against the hidden tests (Ctrl/⌘ + Shift + Enter).'}
      </p>
    );

  const done = run?.status === 'DONE' && revealed >= results.length;
  const shown = results.slice(0, revealed);
  const passed = shown.filter((r) => r.status === 'pass').length;
  const allPassed = done && run!.passed === run!.total && total > 0;
  // Tests the suite promised but never reported (a crash or an early exit) are shown as missing.
  const missing = done ? Math.max(0, total - results.length) : 0;

  return (
    <div className="space-y-3 p-4">
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-md px-4 py-3 transition-colors duration-500 ${
          allPassed ? 'bg-emerald-500/[0.08]' : 'bg-white/[0.03]'
        }`}
        role="status"
      >
        <div className="flex items-baseline gap-3">
          <p className="font-mono text-2xl font-semibold tabular-nums text-ink">
            {run?.status === 'DONE' ? passed : '–'}
            <span className="text-ash-400">/{total || '?'}</span>
          </p>
          <p className="text-xs text-ash-300">
            {kind === 'SUBMIT' ? 'hidden tests passed' : 'visible tests passed'}
          </p>
        </div>
        <p
          className={`text-sm font-semibold ${
            !done ? 'text-ash-300' : allPassed ? 'text-emerald-400' : 'text-red-400'
          }`}
          data-testid={kind === 'SUBMIT' ? 'project-verdict' : undefined}
        >
          {run?.status === 'FAILED'
            ? 'Sandbox error, try again'
            : !run || run.status !== 'DONE'
              ? run?.status === 'RUNNING'
                ? 'Running…'
                : 'Queued…'
              : !done
                ? 'Running…'
                : allPassed
                  ? kind === 'SUBMIT'
                    ? 'All bugs fixed'
                    : 'All visible tests pass'
                  : run.timedOut
                    ? 'Timed out'
                    : 'Some tests fail'}
        </p>
      </div>

      <ul className="space-y-1" aria-label="Test results">
        {results.map((r, i) => (
          <li key={`${r.name}-${i}`} className="rounded-md bg-white/[0.02] px-3 py-2">
            <div className="flex items-center gap-3">
              {i < revealed ? (
                <Dot status={r.status} />
              ) : (
                <span className="block h-4 w-4 shrink-0 rounded-full border-2 border-ash-600 border-t-azure motion-safe:animate-spin" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.name}</span>
              {i < revealed && (
                <span className={`text-xs ${TONE[r.status]}`}>{LABEL[r.status]}</span>
              )}
            </div>
            {i < revealed && r.status !== 'pass' && r.message && (
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap pl-7 font-mono text-[12px] leading-5 text-red-300/90">
                {r.message}
              </pre>
            )}
          </li>
        ))}
        {pending &&
          !results.length &&
          Array.from({ length: Math.min(expected ?? 4, 12) }, (_, i) => (
            <li key={i} className="flex items-center gap-3 rounded-md bg-white/[0.02] px-3 py-2">
              <span className="block h-4 w-4 rounded-full border-2 border-ash-600 border-t-azure motion-safe:animate-spin" />
              <span className="h-3 w-40 rounded bg-white/[0.05]" />
            </li>
          ))}
        {missing > 0 && (
          <li className="rounded-md bg-red-500/[0.06] px-3 py-2 text-sm text-red-300">
            {missing} test{missing > 1 ? 's' : ''} never reported: the suite crashed or exited
            early.
          </li>
        )}
      </ul>

      {run?.output && done && (
        <div>
          <button
            type="button"
            onClick={() => setShowLog((s) => !s)}
            className="cursor-pointer text-xs text-ash-400 underline-offset-4 hover:text-ink hover:underline"
          >
            {showLog ? 'Hide' : 'Show'} test output
          </button>
          {showLog && (
            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-[#0c0c0c] px-3 py-2 font-mono text-[12px] leading-5 text-ash-300">
              {run.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
