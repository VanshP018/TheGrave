import type { InterviewLevel } from '@thegrave/shared';
import { InterviewError } from './errors.js';
import { MAX_FILE_BYTES, acceptContent, shouldConsider } from './filter.js';
import { redactSecrets } from './redact.js';
import type { HistorySignals, RepoMeta, RepoSource, TreeEntry } from './source.js';

export const MAX_TREE_ENTRIES = 20_000;
export const MAX_FETCH_FILES = 120;
export const MAX_TOTAL_BYTES = 1.5 * 1024 * 1024;
const README_BYTES = 4096;
const FETCH_BATCH = 8;

const LANGUAGES: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  scala: 'Scala',
  rb: 'Ruby',
  php: 'PHP',
  cs: 'C#',
  c: 'C',
  h: 'C',
  cc: 'C++',
  cpp: 'C++',
  cxx: 'C++',
  hpp: 'C++',
  swift: 'Swift',
  dart: 'Dart',
  ex: 'Elixir',
  exs: 'Elixir',
  lua: 'Lua',
  sh: 'Shell',
  vue: 'Vue',
  svelte: 'Svelte',
};

const MANIFEST_NAMES = new Set([
  'package.json',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'Gemfile',
  'composer.json',
  'Dockerfile',
  'Makefile',
  'tsconfig.json',
]);

function ext(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}
function base(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
function stem(name: string): string {
  const dot = name.indexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function isManifest(path: string): boolean {
  const name = base(path);
  return (
    MANIFEST_NAMES.has(name) ||
    /^requirements.*\.txt$/.test(name) ||
    /^build\.gradle/.test(name) ||
    /^docker-compose.*\.ya?ml$/.test(name) ||
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)
  );
}

export function isTestFile(path: string): boolean {
  const parts = path.split('/');
  const name = parts[parts.length - 1]!;
  return (
    parts.slice(0, -1).some((d) => ['test', 'tests', '__tests__', 'spec'].includes(d)) ||
    /\.(test|spec)\.[^.]+$/.test(name) ||
    /_test\.[^.]+$/.test(name) ||
    /^test_.*\.py$/.test(name)
  );
}

function isSourceFile(path: string): boolean {
  return ext(path) in LANGUAGES;
}
function isSchemaFile(path: string): boolean {
  return base(path) === 'schema.prisma' || ext(path) === 'sql';
}

const ENTRY_STEMS = new Set(['main', 'index', 'app', 'server', 'cli', '__main__']);
const ROUTE_WORDS = new Set([
  'routes',
  'route',
  'controllers',
  'controller',
  'handlers',
  'handler',
]);
const ROUTE_WORDS2 = new Set(['services', 'service', 'api']);
const MODEL_WORDS = new Set(['models', 'model', 'schema', 'schemas', 'db', 'migrations']);
const CORE_DIRS = new Set(['src', 'lib', 'pkg', 'internal', 'app']);
const EXAMPLE_DIRS = new Set([
  'examples',
  'example',
  'docs',
  'doc',
  'fixtures',
  'fixture',
  'demo',
  'demos',
]);

/** The deterministic 0-100 score a file earns from its path and size alone (plan.md 6.3). */
export function treeScore(
  path: string,
  size: number,
  opts: { hasSourceCounterpart?: boolean } = {},
): number {
  const parts = path.split('/');
  const dirs = parts.slice(0, -1);
  const name = parts[parts.length - 1]!;
  const s = stem(name);
  const words = new Set([...dirs, s]);
  let score = 0;
  if (
    (ENTRY_STEMS.has(s) && isSourceFile(path)) ||
    /^cmd\/[^/]+\/main\.go$/.test(path) ||
    path === 'src/lib.rs'
  )
    score += 30;
  if ([...words].some((w) => ROUTE_WORDS.has(w) || ROUTE_WORDS2.has(w))) score += 20;
  if ([...words].some((w) => MODEL_WORDS.has(w)) || isSchemaFile(path) || name === 'models.py')
    score += 20;
  if (dirs.some((d) => CORE_DIRS.has(d))) score += 15;
  if (isTestFile(path) && opts.hasSourceCounterpart) score += 10;
  if (name === 'Dockerfile' || /^docker-compose/.test(name) || /^\.github\/workflows\//.test(path))
    score += 10;
  if (isManifest(path) && !/^\.github\/workflows\//.test(path) && name !== 'Dockerfile') score += 8;
  if (size >= 2048 && size <= 30 * 1024) score += 10;
  else if (size > 48 * 1024) score -= 10;
  if (dirs.length > 4) score -= 3 * (dirs.length - 4);
  if (dirs.some((d) => EXAMPLE_DIRS.has(d))) score -= 15;
  return Math.max(0, Math.min(100, score));
}

const COMPLEXITY_RE = /\b(?:if|for|while|case|catch)\b|&&|\|\|/g;
const TODO_RE = /\b(?:TODO|FIXME|HACK)\b/g;
const OUTLINE_RE =
  /^(?:export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|interface|type|enum)\b|(?:async\s+)?function\b|class\b|interface\b|type\s+\w+\s*=|(?:async\s+)?def\s|func\s|fn\s|pub\s+(?:async\s+)?fn\s|struct\s|pub\s+struct\s)/;

export function countComplexity(text: string): number {
  return text.match(COMPLEXITY_RE)?.length ?? 0;
}

/** Up to `max` top-level declarations, each cut to `maxChars` (for the triage list). */
export function outlineOf(text: string, max: number, maxChars: number): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (OUTLINE_RE.test(line)) {
      out.push(line.trim().slice(0, maxChars));
      if (out.length >= max) break;
    }
  }
  return out;
}

const JS_EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'];

function importSpecs(path: string, text: string): string[] {
  const e = ext(path);
  const specs: string[] = [];
  if (JS_EXTS.includes(e)) {
    for (const m of text.matchAll(/(?:from\s+|import\s+|require\(\s*)['"]([^'"\n]+)['"]/g))
      specs.push(m[1]!);
  } else if (e === 'py') {
    for (const m of text.matchAll(/^\s*from\s+([.\w]+)\s+import\s/gm)) specs.push(m[1]!);
    for (const m of text.matchAll(/^\s*import\s+([\w.]+)/gm)) specs.push(m[1]!);
  } else if (e === 'go') {
    for (const m of text.matchAll(/^\s*(?:\w+\s+)?"([^"\n]+\/[^"\n]+)"\s*$/gm)) specs.push(m[1]!);
  }
  return specs;
}

function normalizePath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/** Which of `paths` does `spec` (imported from `from`) point at? Simple per-language rules, not a resolver. */
function resolveImport(from: string, spec: string, paths: Set<string>): string[] {
  const e = ext(from);
  const found: string[] = [];
  if (JS_EXTS.includes(e)) {
    if (!spec.startsWith('.')) return found;
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
    const target = normalizePath(`${dir}/${spec}`);
    const bare = target.replace(/\.(?:js|jsx|mjs|cjs)$/, '');
    for (const t of [target, bare]) {
      if (paths.has(t)) found.push(t);
      for (const x of JS_EXTS) {
        if (paths.has(`${t}.${x}`)) found.push(`${t}.${x}`);
        if (paths.has(`${t}/index.${x}`)) found.push(`${t}/index.${x}`);
      }
    }
  } else if (e === 'py') {
    const mod = spec.replace(/^\.+/, '').replace(/\./g, '/');
    if (!mod) return found;
    for (const p of paths)
      if (ext(p) === 'py') {
        const noExt = p.slice(0, -3);
        if (noExt === mod || noExt.endsWith(`/${mod}`) || noExt.endsWith(`/${mod}/__init__`))
          found.push(p);
      }
  } else if (e === 'go') {
    for (const p of paths)
      if (ext(p) === 'go' && p.includes('/')) {
        const dir = p.slice(0, p.lastIndexOf('/'));
        if (spec === dir || spec.endsWith(`/${dir}`)) found.push(p);
      }
  }
  return [...new Set(found)];
}

export interface ProfiledFile {
  path: string;
  size: number;
  treeScore: number;
  /** Redacted. */
  text: string;
  lines: number;
  complexity: number;
  fanIn: number;
  todos: number;
  finalScore: number;
}

export interface RepoProfile {
  displayName: string;
  description: string | null;
  languages: { name: string; share: number }[];
  manifests: string[];
  /** Test files / code files. */
  testRatio: number;
  /** Files left after the tree filter. */
  fileCount: number;
  sourceFileCount: number;
  hasReadme: boolean;
  /** First 4 KB of the README, redacted. */
  readme: string | null;
  history: HistorySignals;
  truncatedTree: boolean;
  redactions: number;
  hasTests: boolean;
  hasCi: boolean;
  /** Fetched, accepted and redacted files, best first. */
  files: ProfiledFile[];
  apparentLevel: InterviewLevel;
}

/** Heuristic level for when triage is unavailable (plan.md 6.5). */
export function heuristicLevel(p: {
  hasTests: boolean;
  hasCi: boolean;
  history: HistorySignals;
}): InterviewLevel {
  return p.hasTests && p.hasCi && p.history.authors > 1 && p.history.totalCommits > 50
    ? 'MID'
    : 'JUNIOR';
}

export function finalScore(f: {
  treeScore: number;
  complexity: number;
  fanIn: number;
  todos: number;
}): number {
  return (
    f.treeScore + Math.min(20, f.complexity / 10) + Math.min(15, f.fanIn * 3) + Math.min(5, f.todos)
  );
}

function readmePath(entries: TreeEntry[]): string | null {
  const hit = entries
    .filter((e) => e.type === 'blob' && /^readme(\.(md|markdown|rst|txt))?$/i.test(e.path))
    .sort((a, b) => a.path.localeCompare(b.path))[0];
  return hit?.path ?? null;
}

/**
 * S2a: read the tree, filter and score it, fetch the best candidates, redact them and compute content signals.
 * Throws NO_SOURCE_FILES when nothing readable survives.
 */
export async function profileRepo(
  source: RepoSource,
  meta: RepoMeta,
  signal: AbortSignal,
): Promise<RepoProfile> {
  const tree = await source.tree(meta, signal);
  const all = tree.entries.slice(0, MAX_TREE_ENTRIES);
  const truncatedTree = tree.truncated || tree.entries.length > MAX_TREE_ENTRIES;
  const considered = all.filter(shouldConsider);

  const sources = considered.filter((e) => isSourceFile(e.path));
  if (sources.length === 0) throw new InterviewError('NO_SOURCE_FILES');

  // Languages by bytes
  const bytesByLang = new Map<string, number>();
  for (const e of sources) {
    const lang = LANGUAGES[ext(e.path)]!;
    bytesByLang.set(lang, (bytesByLang.get(lang) ?? 0) + (e.size ?? 0));
  }
  const totalBytes = [...bytesByLang.values()].reduce((a, b) => a + b, 0) || 1;
  const languages = [...bytesByLang]
    .map(([name, b]) => ({ name, share: Math.round((b / totalBytes) * 1000) / 1000 }))
    .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));

  const manifests = considered
    .filter((e) => isManifest(e.path))
    .map((e) => e.path)
    .sort();
  const testFiles = sources.filter((e) => isTestFile(e.path));
  const testRatio = Math.round((testFiles.length / sources.length) * 1000) / 1000;

  // Tree scores. A test only earns its bonus when a non-test file with the same stem exists, once per stem.
  const nonTestStems = new Set(
    sources.filter((e) => !isTestFile(e.path)).map((e) => stem(base(e.path))),
  );
  const testedStems = new Set<string>();
  const candidates = considered
    .filter((e) => isSourceFile(e.path) || isManifest(e.path) || isSchemaFile(e.path))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((e) => {
      let counterpart = false;
      if (isTestFile(e.path)) {
        const key = stem(base(e.path))
          .replace(/^test_/, '')
          .replace(/_test$/, '');
        if (nonTestStems.has(key) && !testedStems.has(key)) {
          testedStems.add(key);
          counterpart = true;
        }
      }
      return {
        entry: e,
        score: treeScore(e.path, e.size ?? 0, { hasSourceCounterpart: counterpart }),
      };
    })
    .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
    .slice(0, MAX_FETCH_FILES);

  // Fetch, in small batches, until the byte budget is spent.
  const fetched: { path: string; size: number; treeScore: number; text: string }[] = [];
  let redactions = 0;
  let bytes = 0;
  for (let i = 0; i < candidates.length && bytes < MAX_TOTAL_BYTES; i += FETCH_BATCH) {
    const batch = candidates.slice(i, i + FETCH_BATCH);
    const bufs = await Promise.all(
      batch.map((c) => source.readFile(meta, c.entry.path, MAX_FILE_BYTES, signal)),
    );
    for (let j = 0; j < batch.length; j++) {
      const buf = bufs[j];
      if (!buf || bytes + buf.length > MAX_TOTAL_BYTES) continue;
      const verdict = acceptContent(buf);
      if (!verdict.ok) continue;
      bytes += buf.length;
      const red = redactSecrets(verdict.text);
      redactions += red.redactions;
      fetched.push({
        path: batch[j]!.entry.path,
        size: buf.length,
        treeScore: batch[j]!.score,
        text: red.text,
      });
    }
  }
  if (!fetched.some((f) => isSourceFile(f.path))) throw new InterviewError('NO_SOURCE_FILES');

  // Content signals
  const paths = new Set(fetched.map((f) => f.path));
  const fanIn = new Map<string, number>();
  for (const f of fetched) {
    const targets = new Set<string>();
    for (const spec of importSpecs(f.path, f.text))
      for (const t of resolveImport(f.path, spec, paths)) if (t !== f.path) targets.add(t);
    for (const t of targets) fanIn.set(t, (fanIn.get(t) ?? 0) + 1);
  }
  const files: ProfiledFile[] = fetched
    .map((f) => {
      const complexity = countComplexity(f.text);
      const todos = f.text.match(TODO_RE)?.length ?? 0;
      const fi = fanIn.get(f.path) ?? 0;
      return {
        ...f,
        lines: f.text.split('\n').length,
        complexity,
        fanIn: fi,
        todos,
        finalScore: finalScore({ treeScore: f.treeScore, complexity, fanIn: fi, todos }),
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore || a.path.localeCompare(b.path));

  // README (first 4 KB) feeds the summary; it is not a candidate file.
  let readme: string | null = null;
  const rp = readmePath(all);
  if (rp) {
    const buf = await source.readFile(meta, rp, MAX_FILE_BYTES, signal);
    const verdict = buf ? acceptContent(buf) : null;
    if (verdict?.ok) {
      const red = redactSecrets(verdict.text.slice(0, README_BYTES));
      redactions += red.redactions;
      readme = red.text;
    }
  }

  const history = await source.history(meta, signal);
  const hasTests = testFiles.length > 0;
  const hasCi = manifests.some((m) => m.startsWith('.github/workflows/'));
  return {
    displayName: meta.displayName,
    description: meta.description,
    languages,
    manifests,
    testRatio,
    fileCount: considered.length,
    sourceFileCount: sources.length,
    hasReadme: rp !== null,
    readme,
    history,
    truncatedTree,
    redactions,
    hasTests,
    hasCi,
    files,
    apparentLevel: heuristicLevel({ hasTests, hasCi, history }),
  };
}
