import { useQuery } from '@tanstack/react-query';
import {
  DIFFICULTY_POINTS,
  type ActivityDay,
  type ActivityView,
  type SolvedBreakdown,
} from '@thegrave/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { focusRing } from '../ui';

type Filter = 'all' | 'dsa' | 'programming';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'dsa', label: 'DSA' },
  { id: 'programming', label: 'Programming' },
];

const DAY_MS = 86_400_000;
const CELL = 12;
const GAP = 3;
const STEP = CELL + GAP;
const LEFT = 30; // room for the weekday labels
const TOP = 18; // room for the month labels
const WEEKDAY_LABELS: Record<number, string> = { 1: 'Mon', 3: 'Wed', 5: 'Fri' };

/** Fill opacity per intensity level 0-4; level 0 is a faint empty cell. */
const LEVEL_OPACITY = [0, 0.28, 0.5, 0.75, 1];

/** Points in a day -> level: one easy, one medium, a good day, an excellent day. */
const levelOf = (points: number) =>
  points === 0 ? 0 : points <= 2 ? 1 : points <= 5 ? 2 : points <= 9 ? 3 : 4;

const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

const pointsOf = (d: ActivityDay, f: Filter) =>
  f === 'dsa'
    ? d.dsaPoints
    : f === 'programming'
      ? d.programmingPoints
      : d.dsaPoints + d.programmingPoints;
const solvedOf = (d: ActivityDay, f: Filter) =>
  f === 'dsa'
    ? d.dsaSolved
    : f === 'programming'
      ? d.programmingSolved
      : d.dsaSolved + d.programmingSolved;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The heat map: one square per day, a column per week (Sunday first), the last 53 weeks. */
function Heatmap({ activity, filter }: { activity: ActivityView; filter: Filter }) {
  const scroller = useRef<HTMLDivElement>(null);
  const byDate = useMemo(() => new Map(activity.days.map((d) => [d.date, d])), [activity.days]);

  const { cells, weeks, months } = useMemo(() => {
    const end = Date.parse(activity.to);
    const first = Date.parse(activity.from);
    // Start on the Sunday on or before the first day, so every column is a whole week.
    const start = first - new Date(first).getUTCDay() * DAY_MS;
    const total = Math.round((end - start) / DAY_MS) + 1;
    const cells = Array.from({ length: total }, (_, i) => {
      const t = start + i * DAY_MS;
      const date = new Date(t).toISOString().slice(0, 10);
      return { date, week: Math.floor(i / 7), weekday: i % 7, inWindow: t >= first };
    });
    const months: { week: number; label: string }[] = [];
    let lastMonth = -1;
    for (const c of cells) {
      if (c.weekday !== 0 || !c.inWindow) continue;
      const m = new Date(`${c.date}T00:00:00Z`).getUTCMonth();
      if (m !== lastMonth) {
        months.push({
          week: c.week,
          label: new Date(`${c.date}T00:00:00Z`).toLocaleDateString(undefined, {
            month: 'short',
            timeZone: 'UTC',
          }),
        });
        lastMonth = m;
      }
    }
    return { cells, weeks: Math.ceil(total / 7), months };
  }, [activity.from, activity.to]);

  // Open on the most recent weeks, like a contribution graph.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [weeks]);

  const width = LEFT + weeks * STEP;
  const height = TOP + 7 * STEP;
  const shown = activity.days.reduce((n, d) => n + solvedOf(d, filter), 0);

  return (
    <div>
      <div ref={scroller} className="overflow-x-auto pb-2" data-testid="activity-heatmap">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${plural(shown, 'problem')} solved in the last year`}
          className="block min-w-max"
        >
          {months.map((m) => (
            <text
              key={m.week}
              x={LEFT + m.week * STEP}
              y={10}
              className="fill-ash-400"
              fontSize={10}
            >
              {m.label}
            </text>
          ))}
          {Object.entries(WEEKDAY_LABELS).map(([weekday, label]) => (
            <text
              key={label}
              x={0}
              y={TOP + Number(weekday) * STEP + CELL - 2}
              className="fill-ash-400"
              fontSize={10}
            >
              {label}
            </text>
          ))}
          {cells.map((c) => {
            if (!c.inWindow) return null;
            const day = byDate.get(c.date);
            const points = day ? pointsOf(day, filter) : 0;
            const solved = day ? solvedOf(day, filter) : 0;
            const level = levelOf(points);
            const title = solved
              ? `${plural(solved, 'problem')} · ${plural(points, 'point')} on ${dayLabel(c.date)}` +
                (filter === 'all' && day
                  ? ` (DSA ${day.dsaSolved}, programming ${day.programmingSolved})`
                  : '')
              : `No problems solved on ${dayLabel(c.date)}`;
            return (
              <rect
                key={c.date}
                x={LEFT + c.week * STEP}
                y={TOP + c.weekday * STEP}
                width={CELL}
                height={CELL}
                rx={2.5}
                className={level === 0 ? 'fill-white/[0.05]' : 'fill-azure'}
                fillOpacity={level === 0 ? undefined : LEVEL_OPACITY[level]}
                data-level={level}
              >
                <title>{title}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex items-center justify-between gap-4 text-xs text-ash-400">
        <span>
          {plural(shown, 'problem')} solved in the last year
          {filter !== 'all' ? ` (${filter === 'dsa' ? 'DSA' : 'programming'})` : ''}
        </span>
        <span className="flex items-center gap-1.5" aria-hidden>
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <span
              key={l}
              className={`size-3 rounded-[3px] ${l === 0 ? 'bg-white/[0.05]' : 'bg-azure'}`}
              style={l ? { opacity: LEVEL_OPACITY[l] } : undefined}
            />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.25em] text-ash-400">
        {label}
      </dt>
      <dd className="mt-2 whitespace-nowrap font-mono text-3xl font-semibold tabular-nums text-ink sm:text-4xl">
        {value}
      </dd>
      {sub && <p className="mt-1 text-xs text-ash-400">{sub}</p>}
    </div>
  );
}

/** "3 E · 2 M · 1 H" with the point values spelled out for screen readers. */
function Split({ label, b }: { label: string; b: SolvedBreakdown }) {
  const total = b.easy + b.medium + b.hard;
  const rows = [
    ['Easy', b.easy, DIFFICULTY_POINTS.EASY, 'bg-emerald-400/70'],
    ['Medium', b.medium, DIFFICULTY_POINTS.MEDIUM, 'bg-amber-400/70'],
    ['Hard', b.hard, DIFFICULTY_POINTS.HARD, 'bg-red-400/70'],
  ] as const;
  return (
    <div>
      <p className="text-sm font-medium text-ink">
        {label} <span className="font-mono text-ash-400">({total})</span>
      </p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {rows.map(([name, n, worth, dot]) => (
          <li key={name} className="flex items-center gap-2 text-ash-300">
            <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
            <span className="w-14">{name}</span>
            <span className="font-mono tabular-nums text-ink">{n}</span>
            <span className="text-xs text-ash-400">
              × {worth} pt{worth === 1 ? '' : 's'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Problems solved: points, a heat map of the year, streaks and where the player stands. */
export function ActivitySection({ username }: { username: string }) {
  const [filter, setFilter] = useState<Filter>('all');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['profile', username, 'activity'],
    queryFn: () => api<ActivityView>(`/users/${encodeURIComponent(username)}/activity`),
  });

  return (
    <section aria-labelledby="activity-title" data-testid="activity-section">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-azure">Practice</p>
          <h2 id="activity-title" className="mt-2 text-2xl font-semibold tracking-tight text-ink">
            Problems solved
          </h2>
        </div>
        <div
          className="flex rounded-full bg-white/[0.05] p-1"
          role="group"
          aria-label="Heat map filter"
        >
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`h-8 cursor-pointer rounded-full px-4 text-xs font-medium transition-colors ${focusRing} ${
                filter === f.id ? 'bg-white/[0.1] text-ink' : 'text-ash-300 hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-sm text-ash-400">Loading…</p>}
      {isError && <p className="text-sm text-ash-400">Could not load activity.</p>}
      {data && (
        <div className="space-y-10">
          <dl className="flex flex-wrap items-start gap-x-14 gap-y-8" data-testid="activity-stats">
            <Figure label="Points" value={data.points} sub="1 easy · 3 medium · 5 hard" />
            <Figure label="Solved" value={data.solved} />
            <Figure
              label="Streak"
              value={data.currentStreak}
              sub={`best ${data.longestStreak} · ${plural(data.activeDays, 'active day')}`}
            />
            <Figure
              label="Rank"
              value={data.rank.global ? `#${data.rank.global}` : '—'}
              sub={
                data.rank.university
                  ? `#${data.rank.university} at your school`
                  : data.points
                    ? 'no school on record'
                    : 'solve a problem to be ranked'
              }
            />
            <Link
              to="/leaderboard?metric=problems"
              className={`self-end text-sm text-ash-300 underline-offset-4 hover:text-azure hover:underline ${focusRing}`}
            >
              Problems leaderboard →
            </Link>
          </dl>

          <Heatmap activity={data} filter={filter} />

          <div className="grid gap-8 sm:grid-cols-2">
            <Split label="DSA" b={data.dsa} />
            <Split label="Programming" b={data.programming} />
          </div>
        </div>
      )}
    </section>
  );
}
