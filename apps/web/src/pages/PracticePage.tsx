import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LANGUAGES,
  type Language,
  type ProblemDetail,
  type SubmissionView,
} from '@thegrave/shared';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router';
import { CodeEditor } from '../components/battle/CodeEditor';
import { Confetti } from '../components/battle/Confetti';
import { Results } from '../components/battle/ConsolePanel';
import { BackIcon, ChevronIcon, PlayIcon, ResetIcon } from '../components/battle/icons';
import { LastSubmission, type JudgeState } from '../components/battle/Judging';
import { LANGUAGE_LABEL, ProblemPanel } from '../components/battle/ProblemPanel';
import { Splitter, useStoredPercent } from '../components/battle/Splitter';
import { FullScreenMessage } from '../components/ProtectedRoute';
import { btnPrimary, focusRing } from '../components/ui';
import { api, ApiRequestError } from '../lib/api';
import { usePreferredLanguage } from '../lib/preferences';
import { pollSubmission } from '../lib/submissions';

/** Practice drafts persist per problem and language in this browser (unlike battle drafts, which are per tab). */
function usePracticeDraft(slug: string, language: Language, starter: string | undefined) {
  const key = `practice:${slug}:${language}`;
  const [code, setCode] = useState('');
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(key);
    } catch {
      // storage unavailable: start from the starter code
    }
    setCode(saved ?? starter ?? '');
  }, [key, starter]);
  const update = (v: string) => {
    setCode(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // ignore
    }
  };
  return [code, update] as const;
}

const panel = 'overflow-hidden rounded-lg border border-ash-700 bg-ash-900';
const iconBtn = `grid h-8 w-8 cursor-pointer place-items-center rounded-md text-ash-400 transition-colors hover:bg-ash-700 hover:text-ink ${focusRing}`;

type Tab = 'results' | 'submission';

/** Solo practice on one problem (decision.md D-064): the arena's layout without an opponent or a clock. */
export default function PracticePage() {
  const { slug = '' } = useParams();
  const qc = useQueryClient();
  const { data: problem, error } = useQuery({
    queryKey: ['problem', slug],
    queryFn: () => api<ProblemDetail>(`/problems/${slug}`),
  });
  // Opening the problem just marked it seen: the list's eye icons are now stale.
  useEffect(() => {
    if (problem) void qc.invalidateQueries({ queryKey: ['problems'] });
  }, [problem, qc]);

  const [language, setLanguage] = usePreferredLanguage();
  const [code, setCode] = usePracticeDraft(slug, language, problem?.starterCode[language]);
  const [busy, setBusy] = useState<'run' | 'submit' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [run, setRun] = useState<SubmissionView | null>(null);
  const [judge, setJudge] = useState<JudgeState | null>(null);
  const [tab, setTab] = useState<Tab>('results');
  const [confetti, setConfetti] = useState(false);

  const splitRef = useRef<HTMLDivElement>(null);
  const colRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useStoredPercent('practice:left', 42, 25, 65);
  const [consolePct, setConsolePct] = useStoredPercent('practice:console', 36, 15, 70);

  if (error) {
    return (
      <FullScreenMessage>
        {error instanceof ApiRequestError && error.status === 404
          ? 'Problem not found.'
          : 'Could not load the problem.'}
      </FullScreenMessage>
    );
  }
  if (!problem) return <FullScreenMessage>Loading problem…</FullScreenMessage>;

  const fail = (err: unknown, fallback: string) =>
    setMessage(err instanceof ApiRequestError ? err.message : fallback);

  const doRun = async () => {
    if (busy) return;
    setBusy('run');
    setMessage(null);
    setTab('results');
    try {
      const { id } = await api<{ id: string }>(`/problems/${slug}/run`, {
        method: 'POST',
        json: { language, code },
      });
      setRun(await pollSubmission(id));
    } catch (err) {
      fail(err, 'Could not run');
    } finally {
      setBusy(null);
    }
  };

  const doSubmit = async () => {
    if (busy) return;
    setBusy('submit');
    setMessage(null);
    setTab('submission');
    try {
      const { id } = await api<{ id: string }>(`/problems/${slug}/submit`, {
        method: 'POST',
        json: { language, code },
      });
      setJudge({ id, sub: null, animate: true });
      await pollSubmission(id, (sub) => setJudge((j) => (j?.id === id ? { ...j, sub } : j)));
      void qc.invalidateQueries({ queryKey: ['problems'] });
    } catch (err) {
      fail(err, 'Could not submit');
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    if (window.confirm('Replace your code with the starter code?')) {
      setCode(problem.starterCode[language]);
    }
  };

  return (
    <main className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-ash-700/60 px-3 py-2 sm:px-4 lg:h-16 lg:flex-nowrap">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link
            to="/play"
            className={`flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-ash-800 ${focusRing}`}
          >
            <BackIcon className="h-4 w-4" />
            Problems
          </Link>
          <span className="h-5 w-px shrink-0 bg-ash-700" aria-hidden />
          <p className="truncate text-sm font-semibold text-ink">{problem.title}</p>
          <span className="hidden shrink-0 rounded-full bg-white/[0.05] px-2.5 py-0.5 text-[11px] uppercase tracking-widest text-ash-300 sm:inline">
            Practice
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {message && (
            <p className="hidden max-w-xs truncate text-xs text-orange-400 md:block" role="status">
              {message}
            </p>
          )}
          <button
            onClick={doRun}
            disabled={busy !== null}
            title="Run against the examples (Ctrl/⌘ + Enter)"
            className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-ash-700 bg-ash-900 px-4 text-sm font-medium text-ink transition-colors hover:border-ash-600 hover:bg-ash-800 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
          >
            <PlayIcon className="h-3.5 w-3.5" />
            {busy === 'run' ? 'Running…' : 'Run'}
          </button>
          <button
            onClick={doSubmit}
            disabled={busy !== null}
            title="Judge against every test (Ctrl/⌘ + Shift + Enter)"
            className={`${btnPrimary} h-10 rounded-md px-5`}
          >
            {busy === 'submit' ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </header>

      <div
        ref={splitRef}
        className="flex flex-1 flex-col gap-2 p-2 lg:min-h-0 lg:flex-row lg:gap-0"
      >
        <section
          aria-label="Problem"
          style={{ '--left': `${leftPct}%` } as CSSProperties}
          className={`${panel} shrink-0 overflow-y-auto lg:min-h-0 lg:w-[var(--left)]`}
        >
          <ProblemPanel problem={problem} language={language} />
        </section>

        <Splitter
          container={splitRef}
          axis="x"
          value={leftPct}
          onChange={setLeftPct}
          min={25}
          max={65}
          label="Resize problem and editor"
        />

        <div ref={colRef} className="flex min-w-0 flex-1 flex-col gap-2 lg:min-h-0 lg:gap-0">
          <section
            aria-label="Editor"
            className={`${panel} flex h-[60vh] min-h-0 flex-col lg:h-auto lg:flex-1`}
          >
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-ash-700 px-2">
              <div className="relative">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as Language)}
                  className={`h-8 cursor-pointer appearance-none rounded-md border border-ash-700 bg-ash-800 pl-3 pr-8 text-xs font-medium text-ink transition-colors hover:border-ash-600 ${focusRing}`}
                  aria-label="Language"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABEL[l]}
                    </option>
                  ))}
                </select>
                <ChevronIcon className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ash-400" />
              </div>
              <span className="hidden text-[11px] text-ash-400 sm:inline">
                Saved in this browser
              </span>
              <div className="flex-1" />
              <button
                onClick={reset}
                className={iconBtn}
                aria-label="Reset to starter code"
                title="Reset to starter code"
              >
                <ResetIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <CodeEditor
                language={language}
                value={code}
                onChange={setCode}
                onRun={() => void doRun()}
                onSubmit={() => void doSubmit()}
              />
            </div>
          </section>

          <Splitter
            container={colRef}
            axis="y"
            value={consolePct}
            onChange={setConsolePct}
            min={15}
            max={70}
            label="Resize editor and console"
          />

          <section
            aria-label="Console"
            style={{ '--console': `${consolePct}%` } as CSSProperties}
            className={`${panel} flex h-80 shrink-0 flex-col lg:h-[var(--console)]`}
          >
            <div
              className="flex shrink-0 items-center border-b border-ash-700 px-2"
              role="tablist"
              aria-label="Console"
            >
              {(
                [
                  ['results', 'Test results'],
                  ['submission', 'Submission'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`relative flex h-10 cursor-pointer items-center px-3 text-[11px] font-medium uppercase tracking-widest transition-colors ${
                    tab === id
                      ? 'text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-azure'
                      : 'text-ash-400 hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <div hidden={tab !== 'results'} className="h-full">
                <Results key={run?.id} run={run} running={busy === 'run'} />
              </div>
              <div hidden={tab !== 'submission'} className="h-full">
                {judge ? (
                  <div className="p-4">
                    <LastSubmission
                      key={judge.id}
                      judge={judge}
                      total={null}
                      onRevealed={(sub) => sub.verdict === 'ACCEPTED' && setConfetti(true)}
                    />
                  </div>
                ) : (
                  <p className="grid h-full min-h-24 place-items-center px-4 text-center text-sm text-ash-400">
                    Submit to judge your solution against every hidden test. (Ctrl/⌘ + Shift +
                    Enter)
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      {confetti && <Confetti onDone={() => setConfetti(false)} />}
    </main>
  );
}
