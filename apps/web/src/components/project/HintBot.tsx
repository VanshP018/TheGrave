import type { HintMessage, HintResponse } from '@thegrave/shared';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { api, ApiRequestError } from '../../lib/api';
import { ResetIcon, SendIcon } from '../battle/icons';
import { CloseIcon, MinimizeIcon, SparkleIcon } from '../play/icons';
import { focusRing } from '../ui';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const RECT_KEY = 'hintbot:rect';
const MIN_W = 300;
const MIN_H = 320;
const MAX_HISTORY = 20;
const SUGGESTIONS = [
  'Where should I start looking?',
  'How can I reproduce the first ticket?',
  'Am I on the right track?',
];

const maxW = () => Math.min(640, window.innerWidth * 0.9);
const maxH = () => window.innerHeight * 0.8;

/** Keeps the window inside the viewport (at least the whole header stays reachable). */
function clamp(r: Rect): Rect {
  const w = Math.max(Math.min(MIN_W, window.innerWidth), Math.min(r.w, maxW()));
  const h = Math.max(Math.min(MIN_H, window.innerHeight), Math.min(r.h, maxH()));
  return {
    w,
    h,
    x: Math.min(Math.max(0, r.x), Math.max(0, window.innerWidth - w)),
    y: Math.min(Math.max(0, r.y), Math.max(0, window.innerHeight - h)),
  };
}

/** Docked bottom-right, above the launcher. */
function defaultRect(): Rect {
  const w = 360;
  const h = 460;
  return clamp({ w, h, x: window.innerWidth - w - 24, y: window.innerHeight - h - 88 });
}

function loadRect(): Rect {
  try {
    const r = JSON.parse(localStorage.getItem(RECT_KEY) ?? 'null') as Rect | null;
    if (r && [r.x, r.y, r.w, r.h].every(Number.isFinite)) return clamp(r);
  } catch {
    // storage unavailable or corrupt: use the default
  }
  return defaultRect();
}

function loadChat(key: string): HintMessage[] {
  try {
    const m = JSON.parse(sessionStorage.getItem(key) ?? '[]') as HintMessage[];
    return Array.isArray(m)
      ? m.filter(
          (x) => (x?.role === 'user' || x?.role === 'assistant') && typeof x.content === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

/** Inline `code` and **bold**, as React nodes (never HTML), styled like the statement's. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
      <code
        key={i}
        className="rounded-sm border border-ash-700 bg-ash-800 px-1 py-px font-mono text-[0.85em] text-azure-light"
      >
        {part.slice(1, -1)}
      </code>
    ) : part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i} className="font-semibold text-ink">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

/** Paragraphs, line breaks and "- " lists: all the assistant is asked to use. */
function Reply({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (list.length)
      blocks.push(
        <ul key={blocks.length} className="list-disc space-y-1 pl-4 marker:text-azure/70">
          {list.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>,
      );
    if (para.length)
      blocks.push(
        <p key={blocks.length}>
          {para.map((l, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {inline(l)}
            </span>
          ))}
        </p>,
      );
    list = [];
    para = [];
  };
  for (const line of text.split('\n')) {
    const item = /^\s*[-*] (.*)$/.exec(line);
    if (item) {
      if (para.length) flush();
      list.push(item[1]!);
    } else if (line.trim()) {
      if (list.length) flush();
      para.push(line);
    } else flush();
  }
  flush();
  return <div className="space-y-2">{blocks}</div>;
}

function errorText(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.status === 503) return "AI hints aren't set up on this server yet.";
    if (err.status === 429) return 'Too many questions, wait a moment.';
    if (err.status === 409) return err.message;
  }
  return "Couldn't get a hint right now. Try again.";
}

const iconBtn = `grid h-7 w-7 cursor-pointer place-items-center rounded-md text-ash-400 transition-colors hover:bg-white/[0.06] hover:text-ink ${focusRing}`;

/**
 * Floating, draggable, resizable hint assistant for practice (decision.md D-075). It sees the player's
 * current files and answers about this challenge only; the server keeps it to nudges.
 */
export function HintBot(props: {
  slug: string;
  title: string;
  files: Record<string, string>;
  activeFile: string;
}) {
  const { slug, title, files, activeFile } = props;
  const chatKey = `hintbot:${slug}`;
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<Rect>(loadRect);
  const [chat, setChat] = useState<HintMessage[]>(() => loadChat(chatKey));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ mode: 'move' | 'resize'; px: number; py: number; start: Rect } | null>(
    null,
  );

  useEffect(() => {
    try {
      sessionStorage.setItem(chatKey, JSON.stringify(chat));
    } catch {
      // ignore
    }
  }, [chat, chatKey]);

  // Stay inside the viewport when the window shrinks.
  useEffect(() => {
    const onResize = () => setRect((r) => clamp(r));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && open) el.scrollTop = el.scrollHeight;
  }, [chat, busy, error, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Autosize the textarea up to ~5 lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`;
  }, [draft, open]);

  const persistRect = (r: Rect) => {
    try {
      localStorage.setItem(RECT_KEY, JSON.stringify(r));
    } catch {
      // ignore
    }
  };

  const begin = (mode: 'move' | 'resize') => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, px: e.clientX, py: e.clientY, start: rect };
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (d.mode === 'move') {
      setRect(clamp({ ...d.start, x: d.start.x + dx, y: d.start.y + dy }));
      return;
    }
    // Top-left grip: the bottom-right corner stays put, so dragging up/left grows the window.
    const w = Math.max(MIN_W, Math.min(d.start.w - dx, maxW()));
    const h = Math.max(MIN_H, Math.min(d.start.h - dy, maxH()));
    setRect(clamp({ w, h, x: d.start.x + d.start.w - w, y: d.start.y + d.start.h - h }));
  };
  const end = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    persistRect(rect);
  };

  const close = useCallback(() => {
    setOpen(false);
    launcherRef.current?.focus();
  }, []);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next = [...chat, { role: 'user' as const, content }];
    setChat(next);
    setDraft('');
    setError(null);
    setBusy(true);
    try {
      // The last 20 turns, starting on the player's side.
      let sent = next.slice(-MAX_HISTORY);
      while (sent[0]?.role === 'assistant') sent = sent.slice(1);
      const res = await api<HintResponse>(`/projects/${slug}/hint`, {
        method: 'POST',
        json: { messages: sent, files, activeFile },
      });
      setChat((c) => [...c, { role: 'assistant', content: res.reply }]);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
  };

  if (!open) {
    return (
      <button
        ref={launcherRef}
        type="button"
        aria-label="Ask for a hint"
        aria-expanded={false}
        onClick={() => setOpen(true)}
        className={`fixed bottom-6 right-6 z-40 grid h-12 w-12 cursor-pointer place-items-center rounded-full bg-azure text-white shadow-[0_10px_30px_-8px_rgb(0_0_0/0.8)] transition-transform hover:scale-105 hover:bg-azure-light motion-reduce:transition-none motion-reduce:hover:scale-100 ${focusRing}`}
      >
        <SparkleIcon className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Hint assistant"
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      className="group/hint fixed z-40 flex flex-col overflow-hidden rounded-2xl border border-ash-700 bg-gradient-to-b from-[#141414] to-[#0b0b0b] shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9),inset_0_1px_0_rgb(255_255_255/0.06)]"
    >
      <div
        aria-hidden
        title="Resize"
        onPointerDown={begin('resize')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="absolute left-0 top-0 z-10 h-4 w-4 cursor-nwse-resize opacity-0 transition-opacity group-hover/hint:opacity-100"
      >
        <span className="absolute left-1.5 top-1.5 h-2 w-2 rounded-tl-sm border-l-2 border-t-2 border-azure/70" />
      </div>

      <header
        onPointerDown={begin('move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="flex shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b border-ash-700/70 px-3 py-2 active:cursor-grabbing"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-azure/15 text-azure-light">
          <SparkleIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight text-ink">
            Hints <span className="font-normal text-ash-400">· {title}</span>
          </p>
          <p className="text-[11px] leading-tight text-ash-600">Nudges only, never answers</p>
        </div>
        <button
          type="button"
          aria-label="Clear conversation"
          title="Clear conversation"
          disabled={!chat.length}
          onClick={() => {
            setChat([]);
            setError(null);
          }}
          className={`${iconBtn} disabled:cursor-default disabled:opacity-40`}
        >
          <ResetIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Minimize"
          title="Minimize"
          onClick={close}
          className={iconBtn}
        >
          <MinimizeIcon className="h-3.5 w-3.5" />
        </button>
        <button type="button" aria-label="Close" title="Close" onClick={close} className={iconBtn}>
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </header>

      <div
        ref={listRef}
        aria-live="polite"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-[13px] leading-relaxed text-ash-300"
      >
        {!chat.length && !busy && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="max-w-[16rem] text-ash-400">
              Stuck? Ask about this challenge and I&apos;ll point you in the right direction.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className={`cursor-pointer rounded-full border border-ash-700 bg-ash-900 px-3 py-1.5 text-xs text-ash-300 transition-colors hover:border-azure/50 hover:text-ink ${focusRing}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-azure/30 bg-azure/15 px-3 py-2 text-ink">
                {m.content}
              </p>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[90%] break-words rounded-2xl rounded-bl-md border border-ash-700 bg-ash-900 px-3 py-2">
                <Reply text={m.content} />
              </div>
            </div>
          ),
        )}
        {busy && (
          <div className="flex justify-start" role="status" aria-label="Thinking">
            <div className="flex gap-1 rounded-2xl rounded-bl-md border border-ash-700 bg-ash-900 px-3 py-3">
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  style={{ animationDelay: `${d * 150}ms` }}
                  className="h-1.5 w-1.5 rounded-full bg-ash-400 motion-safe:animate-pulse"
                />
              ))}
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-orange-400">
            {error}
          </p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
        className="flex shrink-0 items-end gap-2 border-t border-ash-700/70 p-2.5"
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          maxLength={2000}
          aria-label="Your question"
          placeholder="Ask about this challenge…"
          className={`max-h-[110px] min-h-9 flex-1 resize-none rounded-lg border border-ash-700 bg-hero-bg/60 px-3 py-2 text-[13px] text-ink placeholder:text-ash-600 ${focusRing}`}
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={busy || !draft.trim()}
          className={`grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg bg-azure text-white transition-colors hover:bg-azure-light disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
        >
          <SendIcon className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
