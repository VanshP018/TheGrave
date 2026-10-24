import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export interface TerminalEntry {
  id: number;
  command: string;
  output: string;
  exitCode: number | null;
  timedOut?: boolean;
  running?: boolean;
}

const HELP = `Each command runs in a fresh sandbox with your current files (no network, 10 s limit).
State doesn't carry over between commands, so chain them: cd src && ls
  clear      clear the screen (or Ctrl+L)
  ↑ / ↓      command history`;

/**
 * A command terminal (decision.md D-066): not a live shell, but every command really runs, in the same
 * sandbox the grader uses. `onRun` sends the command and resolves with its output.
 */
export function Terminal(props: {
  entries: TerminalEntry[];
  onRun: (command: string) => void;
  onClear: () => void;
  busy: boolean;
  suggestions: string[];
}) {
  const { entries, onRun, onClear, busy, suggestions } = props;
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const history = entries.map((e) => e.command).filter((c) => c !== 'help');

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [entries]);

  const submit = (cmd: string) => {
    const c = cmd.trim();
    setValue('');
    setCursor(null);
    if (!c) return;
    if (c === 'clear') return onClear();
    onRun(c);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !busy) submit(value);
    else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      onClear();
    } else if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault();
      const i = cursor === null ? history.length - 1 : Math.max(0, cursor - 1);
      setCursor(i);
      setValue(history[i]!);
    } else if (e.key === 'ArrowDown' && cursor !== null) {
      e.preventDefault();
      const i = cursor + 1;
      if (i >= history.length) {
        setCursor(null);
        setValue('');
      } else {
        setCursor(i);
        setValue(history[i]!);
      }
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-[#0c0c0c] font-mono text-[13px] leading-6"
      onClick={() => input.current?.focus()}
    >
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-4 py-3" aria-live="polite">
        {entries.length === 0 && (
          <div className="text-ash-400">
            <p>Sandbox terminal. Type a command, or try one of these:</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!busy) submit(s);
                  }}
                  className="cursor-pointer rounded bg-white/[0.05] px-2 py-0.5 text-azure-light transition-colors hover:bg-white/[0.1]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {entries.map((e) => (
          <div key={e.id} className="mb-2">
            <p>
              <span className="text-emerald-400">~/project</span>
              <span className="text-ash-400"> $ </span>
              <span className="text-ink">{e.command}</span>
            </p>
            {e.running ? (
              <p className="flex items-center gap-2 text-ash-400">
                <span className="h-3 w-3 rounded-full border-2 border-ash-600 border-t-azure motion-safe:animate-spin" />
                running in sandbox…
              </p>
            ) : (
              <>
                {e.output && (
                  <pre className="whitespace-pre-wrap break-words text-ash-300">{e.output}</pre>
                )}
                {e.timedOut ? (
                  <p className="text-orange-400">[timed out after 10 s]</p>
                ) : (
                  e.exitCode !== 0 &&
                  e.exitCode !== null && <p className="text-red-400">[exit {e.exitCode}]</p>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      <label className="flex shrink-0 items-center gap-2 border-t border-ash-800 px-4 py-2">
        <span className="text-emerald-400">~/project</span>
        <span className="text-ash-400">$</span>
        <input
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Terminal command"
          spellCheck={false}
          autoComplete="off"
          placeholder={busy ? 'running…' : 'type a command, e.g. help'}
          className="min-w-0 flex-1 bg-transparent text-ink caret-azure outline-none placeholder:text-ash-600"
        />
      </label>
    </div>
  );
}

export { HELP as TERMINAL_HELP };
