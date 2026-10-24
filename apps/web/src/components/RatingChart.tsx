import { useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * Rating after each game, as a single-series line (dataviz skill: 2px line, end dot with a
 * 2px surface ring, solid hairline grid, crosshair + tooltip, keyboard access, table view).
 * The series color was validated against the card surface for dark mode (decision.md D-052, D-056):
 * brand azure #5cb8ff is too light for the dark band, so the line uses the nearest passing step of its hue.
 */
const SERIES = '#3b9be8';
const SURFACE = '#141414'; // ash-900, the card this chart sits on
const GRID = '#262626'; // ash-700: one step off the surface
const CROSSHAIR = '#8a8a8a'; // ash-400

const HEIGHT = 220;
const M = { top: 16, right: 52, bottom: 28, left: 44 };

export interface RatingPoint {
  at: number;
  rating: number;
}

function niceTicks(min: number, max: number, target = 4): number[] {
  const steps = [5, 10, 25, 50, 100, 200, 250, 500];
  const step = steps.find((s) => (max - min) / s <= target) ?? 1000;
  const ticks: number[] = [];
  for (let t = Math.floor(min / step) * step; t <= max + 1e-9; t += step) ticks.push(t);
  return ticks;
}

/** Width of an element, via a callback ref so it keeps working if the measured element is replaced. */
function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function RatingChart({ points }: { points: RatingPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const geo = useMemo(() => {
    const values = points.map((p) => p.rating);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max(10, (hi - lo) * 0.1);
    const ticks = niceTicks(lo - pad, hi + pad);
    const yMin = ticks[0]!;
    const yMax = ticks.at(-1)!;
    const plotW = Math.max(1, width - M.left - M.right);
    const plotH = HEIGHT - M.top - M.bottom;
    const x = (i: number) =>
      M.left + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
    const y = (v: number) => M.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
    const line = points
      .map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.rating).toFixed(1)}`)
      .join('');
    const baseline = M.top + plotH;
    const games = points.length - 1;
    const xTicks = [...new Set([0, Math.round(games / 2), games])];
    // The first time the highest rating was reached: ringed on the chart (decision.md D-073).
    const peak = values.indexOf(hi);
    return { ticks, x, y, line, plotW, baseline, xTicks, peak };
  }, [points, width]);

  if (points.length < 2) {
    return <p className="py-10 text-center text-sm text-ash-400">No rated games yet.</p>;
  }

  const last = points.length - 1;
  const shown = active ?? null;
  const onPointer = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - box.left) / box.width;
    setActive(Math.max(0, Math.min(last, Math.round(frac * last))));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? last) - 1));
    else if (e.key === 'ArrowRight') setActive((a) => Math.min(last, (a ?? last) + 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(last);
    else return;
    e.preventDefault();
  };

  const p = shown !== null ? points[shown]! : null;
  const delta = shown ? points[shown]!.rating - points[shown - 1]!.rating : null;
  const tipLeft = shown !== null ? Math.min(Math.max(geo.x(shown), 70), width - 70) : 0;

  return (
    <div>
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Rating over ${last} games, from ${points[0]!.rating} to ${points[last]!.rating}, peak ${points[geo.peak]!.rating}. Use arrow keys to inspect games.`}
            tabIndex={0}
            onKeyDown={onKey}
            onFocus={() => setActive((a) => a ?? last)}
            onBlur={() => setActive(null)}
            className="rounded outline-none focus-visible:ring-2 focus-visible:ring-azure/60"
          >
            {geo.ticks.map((t) => (
              <g key={t}>
                <line
                  x1={M.left}
                  x2={M.left + geo.plotW}
                  y1={geo.y(t)}
                  y2={geo.y(t)}
                  stroke={GRID}
                  strokeWidth={1}
                />
                <text
                  x={M.left - 8}
                  y={geo.y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-ash-400 text-[11px] tabular-nums"
                >
                  {t}
                </text>
              </g>
            ))}
            {geo.xTicks.map((g) => (
              <text
                key={g}
                x={geo.x(g)}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="fill-ash-400 text-[11px] tabular-nums"
              >
                {g === 0 ? 'start' : `game ${g}`}
              </text>
            ))}
            {/* No area wash: the y-axis doesn't start at 0, so a fill would imply a magnitude from an arbitrary floor. */}
            <path
              d={geo.line}
              fill="none"
              stroke={SERIES}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {shown !== null && (
              <line
                x1={geo.x(shown)}
                x2={geo.x(shown)}
                y1={M.top}
                y2={geo.baseline}
                stroke={CROSSHAIR}
                strokeWidth={1}
              />
            )}
            {/* Peak: a soft ring and a quiet label, instead of a separate "peak" stat. */}
            {points.length > 1 &&
              (() => {
                const cx = geo.x(geo.peak);
                const cy = geo.y(points[geo.peak]!.rating);
                // Above the ring when there's headroom; otherwise beside it, where the line falls away
                // from a peak (on the left near the right edge).
                const above = cy - M.top > 26;
                const right = cx < width - M.right - 90;
                const pos: { x: number; y: number; anchor: 'start' | 'middle' | 'end' } = above
                  ? {
                      x: cx,
                      y: cy - 16,
                      anchor: cx > width - 60 ? 'end' : cx < M.left + 40 ? 'start' : 'middle',
                    }
                  : { x: right ? cx + 15 : cx - 15, y: cy + 4, anchor: right ? 'start' : 'end' };
                return (
                  <g data-testid="chart-peak">
                    <circle
                      cx={cx}
                      cy={cy}
                      r={9}
                      fill={SERIES}
                      fillOpacity={0.12}
                      stroke={SERIES}
                      strokeOpacity={0.8}
                      strokeWidth={1.5}
                    />
                    <circle cx={cx} cy={cy} r={2.5} fill={SERIES} />
                    <text
                      x={pos.x}
                      y={pos.y}
                      textAnchor={pos.anchor}
                      className="fill-ash-300 text-[11px] font-medium"
                    >
                      Peak {points[geo.peak]!.rating}
                    </text>
                  </g>
                );
              })()}
            {/* End dot (and the hovered point) with a 2px surface ring. */}
            {[last, ...(shown !== null && shown !== last ? [shown] : [])].map((i) => (
              <circle
                key={i}
                cx={geo.x(i)}
                cy={geo.y(points[i]!.rating)}
                r={4}
                fill={SERIES}
                stroke={SURFACE}
                strokeWidth={2}
              />
            ))}
            {/* Selective direct label: the endpoint only. Text wears a text token, not the series color. */}
            <text
              x={geo.x(last) + 10}
              y={geo.y(points[last]!.rating)}
              dy="0.32em"
              className="fill-ink text-xs font-semibold"
            >
              {points[last]!.rating}
            </text>

            {/* Hit target: the whole plot, so the pointer only needs to be near a game, not on the line. */}
            <rect
              x={M.left}
              y={M.top}
              width={geo.plotW}
              height={geo.baseline - M.top}
              fill="transparent"
              onPointerMove={onPointer}
              onPointerLeave={() => setActive(null)}
            />
          </svg>
        )}

        {p && (
          <div
            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border border-ash-600 bg-hero-bg px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: tipLeft }}
            role="status"
          >
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-0.5 w-3 rounded"
                style={{ background: SERIES }}
                aria-hidden
              />
              <span className="font-semibold text-ink">{p.rating}</span>
              {delta !== null && (
                <span className="text-ash-300">
                  ({delta > 0 ? '+' : ''}
                  {delta})
                </span>
              )}
            </div>
            <div className="text-ash-400">
              {shown === 0 ? 'starting rating' : `after game ${shown}`} · {fmtDate(p.at)}
            </div>
          </div>
        )}
      </div>

      <details className="mt-2 text-xs text-ash-300">
        <summary className="cursor-pointer select-none text-ash-400 hover:text-ink">
          Show as table
        </summary>
        <div className="mt-2 max-h-56 overflow-auto rounded border border-ash-700">
          <table className="w-full tabular-nums">
            <thead className="sticky top-0 bg-ash-900 text-left text-ash-400">
              <tr>
                <th className="px-3 py-1 font-medium">Game</th>
                <th className="px-3 py-1 font-medium">Date</th>
                <th className="px-3 py-1 text-right font-medium">Rating</th>
                <th className="px-3 py-1 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {points.map((pt, i) => (
                <tr key={i} className="border-t border-ash-700">
                  <td className="px-3 py-1">{i === 0 ? 'start' : i}</td>
                  <td className="px-3 py-1">{fmtDate(pt.at)}</td>
                  <td className="px-3 py-1 text-right text-ink">{pt.rating}</td>
                  <td className="px-3 py-1 text-right">
                    {i === 0
                      ? ''
                      : `${pt.rating - points[i - 1]!.rating > 0 ? '+' : ''}${pt.rating - points[i - 1]!.rating}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
