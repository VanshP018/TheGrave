import { useQuery } from '@tanstack/react-query';
import type { BattleView, Language, PlayerProgress, SubmissionView } from '@thegrave/shared';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Link, useParams } from 'react-router';
import { CodeEditor } from '../components/battle/CodeEditor';
import { Confetti } from '../components/battle/Confetti';
import { ConsolePanel, type ConsoleTab } from '../components/battle/ConsolePanel';
import { clock } from '../components/battle/format';
import {
  BackIcon,
  ChevronIcon,
  ClockIcon,
  CollapseIcon,
  DocIcon,
  ExpandIcon,
  PlayIcon,
  ResetIcon,
  SwordsIcon,
} from '../components/battle/icons';
import type { JudgeState } from '../components/battle/Judging';
import { MatchPanel, PlayerChip } from '../components/battle/Players';
import { LANGUAGE_LABEL, ProblemPanel } from '../components/battle/ProblemPanel';
import { ResultOverlay } from '../components/battle/ResultOverlay';
import { Splitter, useStoredPercent } from '../components/battle/Splitter';
import { FullScreenMessage } from '../components/ProtectedRoute';
import { btnPrimary, focusRing } from '../components/ui';
import { api, ApiRequestError } from '../lib/api';
import { serverNow } from '../lib/clock';
import { readPreferredLanguage } from '../lib/preferences';
import { pollSubmission } from '../lib/submissions';
import { useNow } from '../lib/useNow';
import { useAuth } from '../stores/auth';

/** Code survives reloads and reconnects (per match and language), but stays in this tab. */
function useDraft(matchId: string, language: Language, starter: string | undefined) {
  const key = `battle:${matchId}:${language}`;
  const [code, setCode] = useState('');
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(key);
    } catch {
      // storage unavailable (private mode): fall back to the starter code
    }
    setCode(saved ?? starter ?? '');
  }, [key, starter]);
  const update = (v: string) => {
    setCode(v);
    try {
      sessionStorage.setItem(key, v);
    } catch {
      // ignore
    }
  };
  return [code, update] as const;
}

const panel = 'overflow-hidden rounded-lg border border-ash-700 bg-ash-900';
const iconBtn = `grid h-8 w-8 cursor-pointer place-items-center rounded-md text-ash-400 transition-colors hover:bg-ash-700 hover:text-ink ${focusRing}`;

type SideTab = 'problem' | 'match';
const SIDE_TABS: { id: SideTab; label: string; icon: typeof DocIcon }[] = [
  { id: 'problem', label: 'Description', icon: DocIcon },
  { id: 'match', label: 'Match', icon: SwordsIcon },
];

/**
 * The arena: an IDE-style workspace (decision.md D-057). Top bar with the clock and both players, an icon
 * rail switching the left panel, a resizable problem | editor split, and a resizable console under the editor.
 */
export default function BattlePage() {
  const { id = '' } = useParams();
  const me = useAuth((s) => s.user?.id);
  useNow(250);
  const now = serverNow();

  const {
    data: v,
    error,
    refetch,
  } = useQuery({
    queryKey: ['match', id],
    queryFn: () => api<BattleView>(`/matches/${id}`),
  });

  // If the "started" event was missed (e.g. while reconnecting), the clock still knows.
  const shouldHaveStarted = !!v && !v.problem && !v.result && now >= v.startsAt;
  useEffect(() => {
    if (shouldHaveStarted) void refetch();
  }, [shouldHaveStarted, refetch]);

  const [language, setLanguage] = useState<Language>(readPreferredLanguage);
  const [code, setCode] = useDraft(id, language, v?.problem?.starterCode[language]);
  const [busy, setBusy] = useState<'run' | 'submit' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<SubmissionView | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>('problem');
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>('results');
  const [focus, setFocus] = useState(false);
  const [judge, setJudge] = useState<JudgeState | null>(null);
  const [confetti, setConfetti] = useState(false);
  // While a submission sent from this page is still sweeping or celebrating, the result overlay waits.
  const [holdResult, setHoldResult] = useState(false);
  const [resultOverdue, setResultOverdue] = useState(false);

  const splitRef = useRef<HTMLDivElement>(null);
  const editorColRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useStoredPercent('arena:left', 42, 25, 65);
  const [consolePct, setConsolePct] = useStoredPercent('arena:console', 34, 15, 70);

  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFocus(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus]);

  const follow = useCallback((subId: string, animate: boolean) => {
    setJudge({ id: subId, sub: null, animate });
    void pollSubmission(subId, (sub) =>
      setJudge((j) => (j?.id === subId ? { ...j, sub } : j)),
    ).catch(() => setHoldResult(false));
  }, []);

  // After a reload, pick the latest submission back up (no animation: it may be long finished).
  const latestId = v?.mySubmissions.at(-1)?.id;
  useEffect(() => {
    if (latestId && !judge) follow(latestId, false);
  }, [latestId, judge, follow]);

  const onRevealed = useCallback((sub: SubmissionView) => {
    if (sub.verdict !== 'ACCEPTED') return setHoldResult(false);
    // Let the burst get going, then bring the result in underneath it.
    setConfetti(true);
    setTimeout(() => setHoldResult(false), 1200);
  }, []);

  // Never hold the result back for long, whatever the judge is doing.
  const hasResult = !!v?.result;
  useEffect(() => {
    if (!hasResult) return;
    const t = setTimeout(() => setResultOverdue(true), 5000);
    return () => clearTimeout(t);
  }, [hasResult]);

  if (error) {
    return (
      <FullScreenMessage>
        {error instanceof ApiRequestError && error.status === 404
          ? 'Match not found.'
          : 'Could not load the match.'}
      </FullScreenMessage>
    );
  }
  if (!v) return <FullScreenMessage>Loading match…</FullScreenMessage>;

  const [mine, theirs] = v.players as [PlayerProgress, PlayerProgress];
  const live = !v.result && now >= v.startsAt && now < v.endsAt;
  const canAct = live && busy === null;

  const submit = async () => {
    if (!canAct) return;
    setBusy('submit');
    setMessage(null);
    setConsoleTab('submissions');
    try {
      const { id: subId } = await api<{ id: string }>(`/matches/${id}/submit`, {
        method: 'POST',
        json: { language, code },
      });
      setHoldResult(true);
      follow(subId, true);
      void refetch();
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : 'Could not submit');
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    if (!v.problem || !canAct) return;
    setBusy('run');
    setMessage(null);
    setConsoleTab('results');
    try {
      const { id: subId } = await api<{ id: string }>(`/problems/${v.problem.slug}/run`, {
        method: 'POST',
        json: { language, code },
      });
      setRunResults(await pollSubmission(subId));
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : 'Could not run');
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    const starter = v.problem?.starterCode[language];
    if (starter !== undefined && window.confirm('Replace your code with the starter code?')) {
      setCode(starter);
    }
  };

  const remaining = v.endsAt - now;
  const timer = v.result
    ? 'Finished'
    : now < v.startsAt
      ? `Starts in ${clock(v.startsAt - now)}`
      : clock(remaining);
  const urgent = live && remaining <= 60_000;

  // Clock + Run + Submit: in the top bar normally, in the editor toolbar in focus mode (never hidden).
  const actions = (
    <>
      {/* The clock turns red for the last minute: a status, not decoration. */}
      <div
        className={`flex h-10 items-center gap-2 rounded-full border px-3.5 font-mono text-base font-semibold tabular-nums ${
          urgent
            ? 'border-red-500/40 bg-red-500/10 text-red-400'
            : 'border-azure/30 bg-azure/[0.06] text-azure'
        }`}
        data-testid="battle-timer"
      >
        <ClockIcon className="h-4 w-4" />
        {timer}
      </div>
      <button
        onClick={run}
        disabled={!canAct || !v.problem}
        title="Run against the examples (Ctrl/⌘ + Enter)"
        className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-ash-700 bg-ash-900 px-4 text-sm font-medium text-ink transition-colors hover:border-ash-600 hover:bg-ash-800 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
      >
        <PlayIcon className="h-3.5 w-3.5" />
        {busy === 'run' ? 'Running…' : 'Run'}
      </button>
      <button
        onClick={submit}
        disabled={!canAct || !v.problem}
        title="Judge against every test (Ctrl/⌘ + Shift + Enter)"
        className={`${btnPrimary} h-10 rounded-md px-5`}
      >
        {busy === 'submit' ? 'Submitting…' : 'Submit'}
      </button>
    </>
  );

  return (
    <main className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      {/* ---- Top bar ------------------------------------------------------------------------------ */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-ash-700/60 px-3 py-2 sm:px-4 lg:h-16 lg:flex-nowrap">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/play"
            onClick={(e) => {
              if (live && !window.confirm('Leave the arena? The clock keeps running.'))
                e.preventDefault();
            }}
            className={`flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-ash-800 ${focusRing}`}
          >
            <BackIcon className="h-4 w-4" />
            Back
          </Link>
          <span className="h-5 w-px shrink-0 bg-ash-700" aria-hidden />
          <p className="truncate text-sm font-semibold text-ink">
            {v.problem?.title ?? 'Waiting for the problem…'}
          </p>
          {!v.rated && (
            <span className="hidden shrink-0 rounded-full bg-white/[0.05] px-2.5 py-0.5 text-[11px] uppercase tracking-widest text-ash-300 sm:inline">
              Friendly · unrated
            </span>
          )}
        </div>

        <div className="order-last flex w-full items-center justify-center gap-2 lg:order-none lg:w-auto lg:flex-1">
          <PlayerChip p={mine} total={v.totalTests} me now={now} />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-azure">vs</span>
          <PlayerChip p={theirs} total={v.totalTests} now={now} testId="opponent-progress" />
        </div>

        {!focus && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </header>

      {!v.problem ? (
        <Countdown mine={mine} theirs={theirs} ms={v.startsAt - now} />
      ) : (
        <div className="flex flex-1 flex-col gap-2 p-2 lg:min-h-0 lg:flex-row lg:gap-0">
          {/* ---- Icon rail (a tab row on small screens) ---------------------------------------- */}
          <nav
            aria-label="Panels"
            className={`${panel} flex shrink-0 gap-1 p-1 lg:mr-2 lg:w-12 lg:flex-col lg:items-center lg:py-2`}
          >
            {SIDE_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setSideTab(t.id)}
                aria-pressed={sideTab === t.id}
                title={t.label}
                className={`relative flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm transition-colors lg:w-9 lg:justify-center lg:px-0 ${focusRing} ${
                  sideTab === t.id
                    ? 'bg-azure/10 text-azure lg:before:absolute lg:before:-left-1 lg:before:top-2 lg:before:h-5 lg:before:w-0.5 lg:before:rounded-full lg:before:bg-azure'
                    : 'text-ash-400 hover:bg-ash-800 hover:text-ink'
                }`}
              >
                <t.icon className="h-[18px] w-[18px] shrink-0" />
                <span className="lg:sr-only">{t.label}</span>
              </button>
            ))}
          </nav>

          <div
            ref={splitRef}
            className="flex min-w-0 flex-1 flex-col gap-2 lg:min-h-0 lg:flex-row lg:gap-0"
          >
            {/* ---- Left panel ------------------------------------------------------------------- */}
            <section
              aria-label={sideTab === 'problem' ? 'Problem' : 'Match'}
              style={{ '--left': `${leftPct}%` } as CSSProperties}
              className={`${panel} shrink-0 overflow-y-auto lg:min-h-0 lg:w-[var(--left)]`}
            >
              {sideTab === 'problem' ? (
                <ProblemPanel problem={v.problem} language={language} />
              ) : (
                <MatchPanel view={v} mine={mine} theirs={theirs} />
              )}
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

            {/* ---- Editor + console (the whole column goes full screen in focus mode) -------------- */}
            <div
              ref={editorColRef}
              className={
                focus
                  ? 'fixed inset-0 z-40 flex flex-col bg-hero-bg p-2'
                  : 'flex min-w-0 flex-1 flex-col gap-2 lg:min-h-0 lg:gap-0'
              }
            >
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
                      {Object.entries(LANGUAGE_LABEL).map(([l, label]) => (
                        <option key={l} value={l}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <ChevronIcon className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ash-400" />
                  </div>
                  <span className="hidden text-[11px] text-ash-400 sm:inline">Autosaved</span>
                  <div className="flex-1" />
                  {focus && <div className="flex items-center gap-2 pr-1">{actions}</div>}
                  <button
                    onClick={reset}
                    className={iconBtn}
                    aria-label="Reset to starter code"
                    title="Reset to starter code"
                  >
                    <ResetIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setFocus((f) => !f)}
                    className={iconBtn}
                    aria-label={focus ? 'Exit focus mode' : 'Focus mode'}
                    title={focus ? 'Exit focus mode (Esc)' : 'Focus mode'}
                  >
                    {focus ? (
                      <CollapseIcon className="h-4 w-4" />
                    ) : (
                      <ExpandIcon className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  <CodeEditor
                    language={language}
                    value={code}
                    onChange={setCode}
                    onRun={() => void run()}
                    onSubmit={() => void submit()}
                  />
                </div>
              </section>

              <Splitter
                container={editorColRef}
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
                className={`${panel} h-80 shrink-0 lg:h-[var(--console)]`}
              >
                <ConsolePanel
                  tab={consoleTab}
                  onTab={setConsoleTab}
                  run={runResults}
                  running={busy === 'run'}
                  view={v}
                  now={now}
                  message={message}
                  judge={judge}
                  onRevealed={onRevealed}
                />
              </section>
            </div>
          </div>
        </div>
      )}

      {confetti && <Confetti onDone={() => setConfetti(false)} />}
      {v.result && (!holdResult || resultOverdue) && (
        <ResultOverlay result={v.result} me={me} opponent={theirs} rated={v.rated} />
      )}
    </main>
  );
}

function Countdown(props: { mine: PlayerProgress; theirs: PlayerProgress; ms: number }): ReactNode {
  const { mine, theirs, ms } = props;
  return (
    <div className="relative grid flex-1 place-items-center overflow-hidden py-16 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_50%_50%,rgb(92_184_255/0.12),transparent_70%)]"
      />
      <div className="relative px-4">
        <p className="text-xs uppercase tracking-[0.3em] text-azure">Get ready</p>
        <div className="mt-6 flex items-center justify-center gap-6">
          {[mine, theirs].map((p, i) => (
            <div key={p.userId} className={i ? 'order-3' : ''}>
              <p className="text-lg font-semibold text-ink">{i ? p.username : 'You'}</p>
              <p className="font-mono text-sm text-ash-400">{p.rating}</p>
            </div>
          ))}
          <span className="order-2 text-sm font-semibold uppercase tracking-widest text-azure">
            vs
          </span>
        </div>
        <p className="mt-6 font-mono text-7xl font-semibold tabular-nums text-ink">{clock(ms)}</p>
        <p className="mt-4 text-sm text-ash-400">
          The problem is revealed to both of you when the countdown ends.
        </p>
      </div>
    </div>
  );
}
