import type { ProjectDetail, ProjectRunView } from '@thegrave/shared';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { pollProjectRun } from '../../lib/submissions';
import { Confetti } from '../battle/Confetti';
import { PlayIcon, ResetIcon } from '../battle/icons';
import { Splitter, useStoredPercent } from '../battle/Splitter';
import { Statement } from '../battle/Statement';
import { FullScreenMessage } from '../ProtectedRoute';
import { btnPrimary, focusRing } from '../ui';
import { fileBadge } from './files';
import { FileTree } from './FileTree';
import { Terminal, TERMINAL_HELP, type TerminalEntry } from './Terminal';
import { TestResults } from './TestResults';
import { WorkspaceEditor } from './WorkspaceEditor';

const panel = 'overflow-hidden rounded-lg border border-ash-700 bg-ash-900';
export const PROJECT_DIFF = {
  EASY: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  MEDIUM: 'border-orange-500/30 bg-orange-500/10 text-orange-400',
  HARD: 'border-red-500/30 bg-red-500/10 text-red-400',
} as const;

type Tab = 'terminal' | 'tests' | 'submission';

/** The player's copy of the codebase, saved under `key` in this browser. */
function useWorkspaceFiles(key: string, starter: Record<string, string> | undefined) {
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (!starter) return;
    let saved: Record<string, string> | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      // storage unavailable or corrupt: start from the starter
    }
    setFiles(saved ?? starter);
  }, [key, starter]);
  const update = useCallback(
    (next: Record<string, string>) => {
      setFiles(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // ignore
      }
    },
    [key],
  );
  return [files, update] as const;
}

/**
 * The debugging workspace (decision.md D-066): bug reports, explorer, tabbed editor, terminal, tests and
 * submission. Practice and programming battles (D-067) share it; they differ in the header and in where
 * Submit goes (`submit` returns the run id to follow).
 */
export function ProjectWorkspace(props: {
  project: ProjectDetail;
  storageKey: string;
  submit: (files: Record<string, string>) => Promise<string>;
  headerStart: ReactNode;
  headerMiddle?: ReactNode;
  headerEnd?: ReactNode;
  /** False outside a battle's live window: Run tests / Submit / the terminal are off. */
  canAct?: boolean;
  onSubmitted?: (run: ProjectRunView) => void;
  /** Floating helper rendered over the workspace with the live files (practice's hint bot, D-075). */
  renderAssistant?: (ctx: { files: Record<string, string>; activeFile: string }) => ReactNode;
  /** Rendered over the workspace (e.g. a battle's result). */
  children?: ReactNode;
}) {
  const { project, storageKey, headerStart, headerMiddle, headerEnd, canAct = true } = props;
  const slug = project.slug;
  const [files, setFiles] = useWorkspaceFiles(storageKey, project.files);
  const [active, setActive] = useState<string | null>(null);
  const [tabs, setTabs] = useState<string[]>([]);
  const [panelTab, setPanelTab] = useState<Tab>('terminal');
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [testRun, setTestRun] = useState<ProjectRunView | null>(null);
  const [submitRun, setSubmitRun] = useState<ProjectRunView | null>(null);
  const [busy, setBusy] = useState<'command' | 'test' | 'submit' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confetti, setConfetti] = useState(false);
  const seq = useRef(0);

  const outerRef = useRef<HTMLDivElement>(null);
  const colRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useStoredPercent('project:left', 30, 18, 50);
  const [consolePct, setConsolePct] = useStoredPercent('project:console', 38, 15, 70);

  // Open the most useful file first: source inside a package folder (where the bugs live), not a demo,
  // README or test.
  useEffect(() => {
    if (active) return;
    const paths = Object.keys(project.files).sort();
    const source = paths.filter(
      (p) => /\.(py|js)$/.test(p) && !p.startsWith('tests/') && !p.endsWith('__init__.py'),
    );
    const first = source.find((p) => p.includes('/')) ?? source[0] ?? paths[0]!;
    setActive(first);
    setTabs([first]);
  }, [project, active]);

  const modified = useMemo(
    () => new Set(files ? Object.keys(files).filter((p) => files[p] !== project.files[p]) : []),
    [files, project],
  );

  if (!files || !active) return <FullScreenMessage>Loading workspace…</FullScreenMessage>;

  const open = (path: string) => {
    setActive(path);
    setTabs((t) => (t.includes(path) ? t : [...t, path]));
  };
  const close = (path: string) => {
    const rest = tabs.filter((t) => t !== path);
    setTabs(rest);
    if (active === path && rest.length) setActive(rest[rest.length - 1]!);
  };

  const start = async (kind: 'COMMAND' | 'TEST' | 'SUBMIT', command?: string) => {
    const res = await api<{ id: string }>(`/projects/${slug}/runs`, {
      method: 'POST',
      json: { kind, command, files },
    });
    return pollProjectRun(res.id);
  };
  const fail = (err: unknown) =>
    setMessage(err instanceof ApiRequestError ? err.message : 'The sandbox could not be reached');

  const runCommand = async (command: string) => {
    if (!canAct) return;
    setPanelTab('terminal');
    const id = ++seq.current;
    if (command === 'help') {
      setEntries((e) => [...e, { id, command, output: TERMINAL_HELP, exitCode: 0 }]);
      return;
    }
    setEntries((e) => [...e, { id, command, output: '', exitCode: null, running: true }]);
    setBusy('command');
    setMessage(null);
    try {
      const r = await start('COMMAND', command);
      setEntries((e) =>
        e.map((x) =>
          x.id === id
            ? {
                ...x,
                running: false,
                output: r.status === 'FAILED' ? 'sandbox error, try again' : (r.output ?? ''),
                exitCode: r.exitCode,
                timedOut: r.timedOut,
              }
            : x,
        ),
      );
    } catch (err) {
      fail(err);
      setEntries((e) => e.filter((x) => x.id !== id));
    } finally {
      setBusy(null);
    }
  };

  const runTests = async () => {
    if (busy || !canAct) return;
    setPanelTab('tests');
    setBusy('test');
    setMessage(null);
    setTestRun(null);
    try {
      setTestRun(await start('TEST'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (busy || !canAct) return;
    setPanelTab('submission');
    setBusy('submit');
    setMessage(null);
    setSubmitRun(null);
    try {
      const run = await pollProjectRun(await props.submit(files));
      setSubmitRun(run);
      props.onSubmitted?.(run);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    if (!window.confirm('Reset every file to the original codebase? Your changes will be lost.'))
      return;
    setFiles(project.files);
  };

  const testCommand = project.testCommand;
  const suggestions =
    project.language === 'python'
      ? ['ls -R', 'python3 main.py', testCommand]
      : ['ls -R', 'node demo.js', testCommand];

  return (
    <main className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      {/* ---- Top bar ----------------------------------------------------------------------------- */}
      {/* Three columns on desktop so a battle's players sit exactly in the middle (decision.md D-068). */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-ash-700/60 px-3 py-2 sm:px-4 lg:grid lg:h-16 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-1 items-center gap-3">{headerStart}</div>
        {headerMiddle ?? <span className="hidden lg:block" />}
        <div className="flex shrink-0 items-center gap-2 lg:justify-self-end">
          {message && (
            <p className="hidden max-w-xs truncate text-xs text-orange-400 md:block" role="alert">
              {message}
            </p>
          )}
          {headerEnd}
          <button
            onClick={reset}
            title="Reset the codebase"
            aria-label="Reset the codebase"
            className={`grid h-10 w-10 cursor-pointer place-items-center rounded-md text-ash-400 transition-colors hover:bg-ash-800 hover:text-ink ${focusRing}`}
          >
            <ResetIcon className="h-4 w-4" />
          </button>
          <button
            onClick={() => void runTests()}
            disabled={busy !== null || !canAct}
            title={`Run the visible tests: ${testCommand} (Ctrl/⌘ + Enter)`}
            className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-ash-700 bg-ash-900 px-4 text-sm font-medium text-ink transition-colors hover:border-ash-600 hover:bg-ash-800 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
          >
            <PlayIcon className="h-3.5 w-3.5" />
            {busy === 'test' ? 'Testing…' : 'Run tests'}
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy !== null || !canAct}
            title="Grade against the hidden tests (Ctrl/⌘ + Shift + Enter)"
            className={`${btnPrimary} h-10 rounded-md px-5`}
          >
            {busy === 'submit' ? 'Grading…' : 'Submit'}
          </button>
        </div>
      </header>

      <div
        ref={outerRef}
        className="flex flex-1 flex-col gap-2 p-2 lg:min-h-0 lg:flex-row lg:gap-0"
      >
        {/* ---- Bug reports -------------------------------------------------------------------------- */}
        <section
          aria-label="Challenge"
          style={{ '--left': `${leftPct}%` } as CSSProperties}
          className={`${panel} max-h-[60vh] shrink-0 overflow-y-auto lg:max-h-none lg:min-h-0 lg:w-[var(--left)]`}
        >
          <article className="space-y-4 px-5 py-5">
            <header className="space-y-2">
              <h1
                className="text-xl font-semibold tracking-[-0.01em] text-ink"
                data-testid="project-title"
              >
                {project.title}
              </h1>
              <div className="flex flex-wrap gap-1.5">
                {project.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-ash-300"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </header>
            <Statement markdown={project.statement} />
          </article>
        </section>

        <Splitter
          container={outerRef}
          axis="x"
          value={leftPct}
          onChange={setLeftPct}
          min={18}
          max={50}
          label="Resize challenge and workspace"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-2 lg:min-h-0 lg:flex-row">
          {/* ---- Explorer --------------------------------------------------------------------------- */}
          <nav aria-label="File explorer" className={`${panel} shrink-0 overflow-y-auto lg:w-56`}>
            <p className="flex h-10 items-center border-b border-ash-700 px-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-ash-400">
              Explorer
            </p>
            <FileTree
              paths={Object.keys(files)}
              active={active}
              modified={modified}
              onOpen={open}
            />
          </nav>

          {/* ---- Editor + console --------------------------------------------------------------------- */}
          <div ref={colRef} className="flex min-w-0 flex-1 flex-col gap-2 lg:min-h-0 lg:gap-0">
            <section
              aria-label="Editor"
              className={`${panel} flex h-[60vh] min-h-0 flex-col lg:h-auto lg:flex-1`}
            >
              <div
                className="flex h-10 shrink-0 items-stretch overflow-x-auto border-b border-ash-700 [scrollbar-width:none]"
                role="tablist"
                aria-label="Open files"
              >
                {tabs.map((t) => {
                  const badge = fileBadge(t);
                  return (
                    <div
                      key={t}
                      className={`group flex shrink-0 items-center border-r border-ash-800 ${
                        t === active
                          ? 'bg-ash-900 text-ink shadow-[inset_0_-2px_0_var(--color-azure)]'
                          : 'bg-[#101010] text-ash-400'
                      }`}
                    >
                      <button
                        role="tab"
                        aria-selected={t === active}
                        onClick={() => setActive(t)}
                        title={t}
                        className={`flex h-full cursor-pointer items-center gap-2 pl-3 pr-1 text-[13px] ${focusRing}`}
                      >
                        <span className={`font-mono text-[10px] font-bold ${badge.tone}`}>
                          {badge.text}
                        </span>
                        {t.split('/').pop()}
                        {modified.has(t) && <span className="h-1.5 w-1.5 rounded-full bg-azure" />}
                      </button>
                      <button
                        onClick={() => close(t)}
                        aria-label={`Close ${t}`}
                        className="mr-1 grid h-6 w-6 cursor-pointer place-items-center rounded text-ash-600 opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="shrink-0 truncate px-4 py-1.5 font-mono text-[11px] text-ash-600">
                {active}
              </p>
              <div className="min-h-0 flex-1">
                <WorkspaceEditor
                  path={active}
                  value={files[active] ?? ''}
                  onChange={(v) => setFiles({ ...files, [active]: v })}
                  onRunTests={() => void runTests()}
                  onSubmit={() => void submit()}
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
                    ['terminal', 'Terminal'],
                    ['tests', 'Tests'],
                    ['submission', 'Submission'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={panelTab === id}
                    onClick={() => setPanelTab(id)}
                    className={`relative flex h-10 cursor-pointer items-center px-3 text-[11px] font-medium uppercase tracking-widest transition-colors ${
                      panelTab === id
                        ? 'text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-azure'
                        : 'text-ash-400 hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <div hidden={panelTab !== 'terminal'} className="h-full">
                  <Terminal
                    entries={entries}
                    onRun={(c) => void runCommand(c)}
                    onClear={() => setEntries([])}
                    busy={busy === 'command' || !canAct}
                    suggestions={suggestions}
                  />
                </div>
                <div hidden={panelTab !== 'tests'}>
                  <TestResults
                    run={testRun}
                    pending={busy === 'test'}
                    kind="TEST"
                    expected={null}
                  />
                </div>
                <div hidden={panelTab !== 'submission'}>
                  <TestResults
                    run={submitRun}
                    pending={busy === 'submit'}
                    kind="SUBMIT"
                    expected={null}
                    onAllPassed={() => setConfetti(true)}
                  />
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      {props.children}
      {props.renderAssistant?.({ files, activeFile: active })}
      {confetti && <Confetti onDone={() => setConfetti(false)} />}
    </main>
  );
}
