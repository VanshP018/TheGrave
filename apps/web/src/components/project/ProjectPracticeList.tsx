import type { Difficulty, ProjectSummary } from '@thegrave/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../lib/api';
import { ChevronIcon } from '../battle/icons';
import { CheckCircleIcon, LayersIcon, SearchIcon, ShuffleIcon, SortIcon } from '../play/icons';
import { control, DIFF, DIFF_ORDER, pill, SolvedRing } from '../play/PracticeList';
import { focusRing } from '../ui';

const LANG = {
  python: { label: 'Python', tone: 'bg-[#3776ab]/20 text-[#8ab8e6]' },
  node: { label: 'Node.js', tone: 'bg-[#5fa04e]/20 text-[#9bd08c]' },
} as const;

type Status = 'all' | 'unsolved' | 'solved' | 'attempted' | 'fresh';
const STATUS: { id: Status; label: string }[] = [
  { id: 'all', label: 'All statuses' },
  { id: 'unsolved', label: 'Unsolved' },
  { id: 'solved', label: 'Solved' },
  { id: 'attempted', label: 'Attempted' },
  { id: 'fresh', label: 'Not tried yet' },
];

type Sort = 'default' | 'title' | 'files';
const SORT_LABEL: Record<Sort, string> = { default: 'Difficulty', title: 'Title', files: 'Size' };
const NEXT_SORT: Record<Sort, Sort> = { default: 'title', title: 'files', files: 'default' };

/**
 * The programming practice set, in the DSA list's design (decision.md D-064, D-069): topic chips, search,
 * difficulty, status, sort, solved ring and a random pick over thin alternating rows.
 */
export function ProjectPracticeList() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<ProjectSummary[]>('/projects'),
  });
  const projects = useMemo(() => data ?? [], [data]);

  const [topic, setTopic] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty | 'ALL'>('ALL');
  const [status, setStatus] = useState<Status>('all');
  const [sort, setSort] = useState<Sort>('default');
  const [expanded, setExpanded] = useState(false);

  // Topics are the tags, language included, most common first.
  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of projects) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [projects]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = projects.filter(
      (p) =>
        (!topic || p.tags.includes(topic)) &&
        (difficulty === 'ALL' || p.difficulty === difficulty) &&
        (status === 'all' ||
          (status === 'solved' && p.solved) ||
          (status === 'unsolved' && !p.solved) ||
          (status === 'attempted' && p.attempted && !p.solved) ||
          (status === 'fresh' && !p.attempted)) &&
        (!q ||
          p.title.toLowerCase().includes(q) ||
          p.summary.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q))),
    );
    if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'files') list.sort((a, b) => a.fileCount - b.fileCount);
    else
      list.sort(
        (a, b) =>
          DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty] || a.title.localeCompare(b.title),
      );
    return list;
  }, [projects, topic, query, difficulty, status, sort]);

  const solved = projects.filter((p) => p.solved).length;
  const pickRandom = () => {
    const pool = rows.filter((p) => !p.solved);
    const from = pool.length ? pool : rows;
    const p = from[Math.floor(Math.random() * from.length)];
    if (p) navigate(`/projects/${p.slug}`);
  };

  return (
    <section aria-labelledby="project-practice-title" className="mt-14">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-azure">Practice</p>
        <h2
          id="project-practice-title"
          className="mt-2 text-2xl font-semibold tracking-tight text-ink"
        >
          Debug at your own pace
        </h2>
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
          <span className="sr-only">Search challenges</span>
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ash-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search challenges"
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
          <SolvedRing solved={solved} total={projects.length} />
          <button
            onClick={pickRandom}
            disabled={!rows.length}
            aria-label="Pick a random challenge"
            title="Pick a random unsolved challenge"
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
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-14 rounded-xl bg-white/[0.03] motion-safe:animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="py-16 text-center text-sm text-ash-400">Could not load the challenges.</p>
        ) : !rows.length ? (
          <p className="py-16 text-center text-sm text-ash-400">
            No challenges match these filters.
          </p>
        ) : (
          <ul aria-label="Programming challenges">
            {rows.map((p, i) => (
              <li key={p.slug}>
                <Link
                  to={`/projects/${p.slug}`}
                  title={p.summary}
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
                  <span className="flex min-w-0 flex-1 items-baseline gap-3">
                    <span className="shrink-0 text-[15px] font-medium text-ink group-hover:text-azure-light">
                      {p.title}
                    </span>
                    <span className="hidden truncate text-sm font-light text-ash-400 md:inline">
                      {p.summary}
                    </span>
                  </span>
                  <span className="hidden shrink-0 gap-1.5 lg:flex">
                    {p.tags
                      .filter((t) => t !== LANG[p.language].label)
                      .slice(0, 2)
                      .map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-ash-300"
                        >
                          {t}
                        </span>
                      ))}
                  </span>
                  <span
                    className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline ${LANG[p.language].tone}`}
                  >
                    {LANG[p.language].label}
                  </span>
                  <span className="hidden w-20 shrink-0 whitespace-nowrap text-right font-mono text-sm tabular-nums text-ash-400 sm:block">
                    {p.fileCount} files
                  </span>
                  <span
                    className={`w-12 shrink-0 text-right text-sm font-medium ${DIFF[p.difficulty].tone}`}
                  >
                    {DIFF[p.difficulty].label}
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
