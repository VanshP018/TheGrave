import type { Difficulty, ProblemListItem } from '@thegrave/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../lib/api';
import { ChevronIcon } from '../battle/icons';
import { focusRing } from '../ui';
import { CheckCircleIcon, EyeIcon, LayersIcon, SearchIcon, ShuffleIcon, SortIcon } from './icons';

const DIFF: Record<Difficulty, { label: string; tone: string }> = {
  EASY: { label: 'Easy', tone: 'text-emerald-400' },
  MEDIUM: { label: 'Med.', tone: 'text-orange-400' },
  HARD: { label: 'Hard', tone: 'text-red-400' },
};
const DIFF_ORDER: Record<Difficulty, number> = { EASY: 0, MEDIUM: 1, HARD: 2 };

type Status = 'all' | 'unsolved' | 'solved' | 'fresh';
const STATUS: { id: Status; label: string }[] = [
  { id: 'all', label: 'All statuses' },
  { id: 'unsolved', label: 'Unsolved' },
  { id: 'solved', label: 'Solved' },
  { id: 'fresh', label: 'Not opened yet' },
];

type Sort = 'default' | 'acceptance' | 'title';
const SORT_LABEL: Record<Sort, string> = {
  default: 'Difficulty',
  acceptance: 'Acceptance',
  title: 'Title',
};
const NEXT_SORT: Record<Sort, Sort> = {
  default: 'acceptance',
  acceptance: 'title',
  title: 'default',
};

const pill = `inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full px-4 text-sm transition-colors ${focusRing}`;
const control = `h-10 cursor-pointer rounded-full bg-white/[0.05] text-sm text-ink transition-colors hover:bg-white/[0.08] ${focusRing}`;

/** Solved progress as a small ring next to the count. */
function SolvedRing({ solved, total }: { solved: number; total: number }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  return (
    <span className="inline-flex items-center gap-2.5 text-sm text-ash-300">
      <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90" aria-hidden>
        <circle cx="10" cy="10" r={r} fill="none" strokeWidth="2.5" className="stroke-ash-700" />
        <circle
          cx="10"
          cy="10"
          r={r}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="stroke-emerald-400 transition-[stroke-dashoffset] duration-700"
          strokeDasharray={c}
          strokeDashoffset={total ? c * (1 - solved / total) : c}
        />
      </svg>
      <span>
        <span className="font-mono text-ink">{solved}</span>/{total} Solved
      </span>
    </span>
  );
}

/**
 * The practice set (decision.md D-064): topic chips, search and filters over the problem list, one row per
 * problem. Opening a problem marks it seen, which takes it out of the player's ranked pool (D-042).
 */
export function PracticeList() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['problems'],
    queryFn: () => api<ProblemListItem[]>('/problems'),
  });
  const problems = useMemo(() => data ?? [], [data]);

  const [topic, setTopic] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty | 'ALL'>('ALL');
  const [status, setStatus] = useState<Status>('all');
  const [sort, setSort] = useState<Sort>('default');
  const [expanded, setExpanded] = useState(false);

  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of problems) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [problems]);

  // A stable number per problem, in the default (difficulty, title) order the API returns.
  const number = useMemo(() => new Map(problems.map((p, i) => [p.slug, i + 1])), [problems]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = problems.filter(
      (p) =>
        (!topic || p.tags.includes(topic)) &&
        (difficulty === 'ALL' || p.difficulty === difficulty) &&
        (status === 'all' ||
          (status === 'solved' && p.solved) ||
          (status === 'unsolved' && !p.solved) ||
          (status === 'fresh' && !p.seen)) &&
        (!q ||
          p.title.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))),
    );
    if (sort === 'acceptance') list.sort((a, b) => (b.acceptance ?? -1) - (a.acceptance ?? -1));
    else if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
    else
      list.sort(
        (a, b) =>
          DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty] ||
          number.get(a.slug)! - number.get(b.slug)!,
      );
    return list;
  }, [problems, topic, query, difficulty, status, sort, number]);

  const solved = problems.filter((p) => p.solved).length;
  const pickRandom = () => {
    const pool = rows.filter((p) => !p.solved);
    const from = pool.length ? pool : rows;
    const p = from[Math.floor(Math.random() * from.length)];
    if (p) navigate(`/practice/${p.slug}`);
  };

  return (
    <section aria-labelledby="practice-title" className="mt-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-azure">Practice</p>
          <h2 id="practice-title" className="mt-2 text-2xl font-semibold tracking-tight text-ink">
            Sharpen up between battles
          </h2>
        </div>
        <p className="flex items-center gap-2 text-xs text-ash-400">
          <EyeIcon className="h-3.5 w-3.5" />
          Opening a problem takes it out of your ranked pool.
        </p>
      </div>

      {/* ---- Topics ------------------------------------------------------------------------------ */}
      <div className="mt-6 flex items-start gap-2">
        <div
          className={`flex flex-1 gap-2 ${expanded ? 'flex-wrap' : 'overflow-x-auto [mask-image:linear-gradient(to_right,black_90%,transparent)] [scrollbar-width:none]'}`}
          role="group"
          aria-label="Topics"
        >
          <button
            onClick={() => setTopic(null)}
            aria-pressed={topic === null}
            className={`${pill} ${topic === null ? 'bg-ink font-medium text-hero-bg' : 'bg-white/[0.05] text-ink hover:bg-white/[0.09]'}`}
          >
            <LayersIcon className="h-4 w-4" />
            All topics
          </button>
          {topics.map(([t, n]) => (
            <button
              key={t}
              onClick={() => setTopic(topic === t ? null : t)}
              aria-pressed={topic === t}
              className={`${pill} ${topic === t ? 'bg-azure font-medium text-hero-bg' : 'bg-white/[0.05] text-ink hover:bg-white/[0.09]'}`}
            >
              {t}
              <span
                className={`rounded-full px-1.5 font-mono text-[11px] ${topic === t ? 'bg-hero-bg/15' : 'bg-white/[0.07] text-ash-300'}`}
              >
                {n}
              </span>
            </button>
          ))}
        </div>
        {topics.length > 6 && (
          <button
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className={`${pill} text-ash-300 hover:text-ink`}
          >
            {expanded ? 'Collapse' : 'Expand'}
            <ChevronIcon
              className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>

      {/* ---- Toolbar ----------------------------------------------------------------------------- */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <label className="relative w-full sm:w-72">
          <span className="sr-only">Search questions</span>
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ash-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions"
            className={`${control} w-full cursor-text pl-11 pr-4 placeholder:text-ash-400`}
          />
        </label>
        <div className="flex rounded-full bg-white/[0.05] p-1" role="group" aria-label="Difficulty">
          {(['ALL', 'EASY', 'MEDIUM', 'HARD'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDifficulty(d)}
              aria-pressed={difficulty === d}
              className={`h-8 cursor-pointer rounded-full px-3 text-xs font-medium transition-colors ${focusRing} ${
                difficulty === d
                  ? 'bg-white/[0.1] text-ink'
                  : `${d === 'ALL' ? 'text-ash-300' : DIFF[d].tone} opacity-80 hover:opacity-100`
              }`}
            >
              {d === 'ALL' ? 'All' : d === 'MEDIUM' ? 'Medium' : DIFF[d].label}
            </button>
          ))}
        </div>
        <label className="relative">
          <span className="sr-only">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            className={`${control} appearance-none pl-4 pr-9`}
          >
            {STATUS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <ChevronIcon className="pointer-events-none absolute right-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ash-400" />
        </label>
        <button
          onClick={() => setSort(NEXT_SORT[sort])}
          title="Change sort order"
          className={`${control} inline-flex items-center gap-2 px-4`}
        >
          <SortIcon className="h-4 w-4 text-ash-300" />
          {SORT_LABEL[sort]}
        </button>

        <div className="ml-auto flex items-center gap-2">
          <SolvedRing solved={solved} total={problems.length} />
          <button
            onClick={pickRandom}
            disabled={!rows.length}
            aria-label="Pick a random problem"
            title="Pick a random unsolved problem"
            className={`${control} grid w-10 place-items-center disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <ShuffleIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ---- Rows -------------------------------------------------------------------------------- */}
      <div className="mt-5">
        {isLoading ? (
          <div className="space-y-2" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-14 rounded-xl bg-white/[0.03] motion-safe:animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="py-16 text-center text-sm text-ash-400">Could not load the problems.</p>
        ) : !rows.length ? (
          <p className="py-16 text-center text-sm text-ash-400">No problems match these filters.</p>
        ) : (
          <ul aria-label="Problems">
            {rows.map((p, i) => (
              <li key={p.slug}>
                <Link
                  to={`/practice/${p.slug}`}
                  className={`group flex h-14 items-center gap-4 rounded-xl px-4 transition-colors sm:px-5 ${focusRing} ${
                    i % 2 ? '' : 'bg-white/[0.03]'
                  } hover:bg-white/[0.07]`}
                >
                  <span
                    className="w-5 shrink-0"
                    title={p.solved ? 'Solved' : p.attempted ? 'Attempted' : undefined}
                  >
                    {p.solved ? (
                      <CheckCircleIcon className="h-5 w-5 text-emerald-400" />
                    ) : p.attempted ? (
                      <span className="mx-auto block h-1.5 w-1.5 rounded-full bg-orange-400" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">
                    <span className="text-ash-400">{number.get(p.slug)}. </span>
                    <span className="group-hover:text-azure-light">{p.title}</span>
                  </span>
                  <span className="hidden shrink-0 gap-1.5 lg:flex">
                    {p.tags.slice(0, 2).map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-ash-300"
                      >
                        {t}
                      </span>
                    ))}
                  </span>
                  <span className="hidden w-16 shrink-0 text-right font-mono text-sm tabular-nums text-ash-300 sm:block">
                    {p.acceptance === null ? '—' : `${(p.acceptance * 100).toFixed(1)}%`}
                  </span>
                  <span
                    className={`w-12 shrink-0 text-right text-sm font-medium ${DIFF[p.difficulty].tone}`}
                  >
                    {DIFF[p.difficulty].label}
                  </span>
                  <span
                    className="w-5 shrink-0"
                    title={p.seen ? 'Opened: battles won’t pick it for you' : undefined}
                  >
                    {p.seen && <EyeIcon className="h-4 w-4 text-ash-600" />}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
