import { useEffect, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';

/** A percentage that survives reloads (per browser). Storage failures just mean the default is used. */
export function useStoredPercent(key: string, initial: number, min: number, max: number) {
  const [value, setValue] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      if (saved >= min && saved <= max) return saved;
    } catch {
      // storage unavailable
    }
    return initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // ignore
    }
  }, [key, value]);
  return [value, setValue] as const;
}

interface Props {
  /** The element the percentage is measured against. */
  container: RefObject<HTMLElement | null>;
  /** "x": drag left/right, value = left pane's width. "y": drag up/down, value = bottom pane's height. */
  axis: 'x' | 'y';
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  label: string;
}

/**
 * Drag handle between two panes (pointer capture, so the editor underneath never steals the drag), and a
 * keyboard-operable `separator` (arrows move 2%, Home/End jump to the limits).
 */
export function Splitter({ container, axis, value, onChange, min, max, label }: Props) {
  const [dragging, setDragging] = useState(false);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !container.current) return;
    const r = container.current.getBoundingClientRect();
    onChange(
      clamp(
        axis === 'x'
          ? ((e.clientX - r.left) / r.width) * 100
          : ((r.bottom - e.clientY) / r.height) * 100,
      ),
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = axis === 'x' ? 'ArrowRight' : 'ArrowUp';
    const shrink = axis === 'x' ? 'ArrowLeft' : 'ArrowDown';
    if (e.key === grow) onChange(clamp(value + 2));
    else if (e.key === shrink) onChange(clamp(value - 2));
    else if (e.key === 'Home') onChange(min);
    else if (e.key === 'End') onChange(max);
    else return;
    e.preventDefault();
  };

  // While dragging, keep the resize cursor everywhere and stop text selection across the panes.
  useEffect(() => {
    if (!dragging) return;
    const { style } = document.body;
    style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    style.userSelect = 'none';
    return () => {
      style.cursor = '';
      style.userSelect = '';
    };
  }, [dragging, axis]);

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={onKeyDown}
      className={`group relative z-10 hidden shrink-0 touch-none items-center justify-center outline-none lg:flex ${
        axis === 'x' ? 'w-2 cursor-col-resize flex-col' : 'h-2 cursor-row-resize'
      }`}
    >
      {/* Grip: three dots, blue while hovered, dragged or focused. */}
      <span
        className={`flex gap-[3px] ${axis === 'x' ? 'flex-col' : 'flex-row'} ${
          dragging
            ? '[&>*]:bg-azure'
            : '[&>*]:bg-ash-600 group-hover:[&>*]:bg-azure group-focus-visible:[&>*]:bg-azure'
        }`}
      >
        <i className="h-[3px] w-[3px] rounded-full transition-colors" />
        <i className="h-[3px] w-[3px] rounded-full transition-colors" />
        <i className="h-[3px] w-[3px] rounded-full transition-colors" />
      </span>
    </div>
  );
}
