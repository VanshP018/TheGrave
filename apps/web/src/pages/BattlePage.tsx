import { useQuery } from '@tanstack/react-query';
import type {
  BattleView,
  Language,
  MatchResult,
  PlayerProgress,
  SubmissionView,
  TestResultView,
} from '@thegrave/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { CodeEditor } from '../components/battle/CodeEditor';
import { Statement } from '../components/battle/Statement';
import { FullScreenMessage } from '../components/ProtectedRoute';
import { api, ApiRequestError } from '../lib/api';
import { serverNow } from '../lib/clock';
import { useNow } from '../lib/useNow';
import { useAuth } from '../stores/auth';

const LANGUAGE_LABEL: Record<Language, string> = { python: 'Python 3', cpp: 'C++17' };

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

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

async function pollSubmission(id: string): Promise<SubmissionView> {
  for (;;) {
    const s = await api<SubmissionView>(`/submissions/${id}`);
    if (s.status === 'DONE' || s.status === 'FAILED') return s;
    await new Promise((r) => setTimeout(r, 400));
  }
}

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

  const [language, setLanguage] = useState<Language>('python');
  const [code, setCode] = useDraft(id, language, v?.problem?.starterCode[language]);
  const [busy, setBusy] = useState<'run' | 'submit' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<SubmissionView | null>(null);

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

  const submit = async () => {
    setBusy('submit');
    setMessage(null);
    try {
      await api(`/matches/${id}/submit`, { method: 'POST', json: { language, code } });
      setMessage('Submitted, judging…');
      void refetch();
    } catch (err) {
      setMessage(err instanceof ApiRequestError ? err.message : 'Could not submit');
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    if (!v.problem) return;
    setBusy('run');
    setMessage(null);
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

  return (
    <main className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <Link to="/play" className="font-bold tracking-tight">
          theGrave
        </Link>
        <div className="font-mono text-2xl tabular-nums" data-testid="battle-timer">
          {v.result
            ? 'Finished'
            : now < v.startsAt
              ? `Starts in ${clock(v.startsAt - now)}`
              : clock(v.endsAt - now)}
        </div>
        <div className="flex gap-3">
          <PlayerCard p={mine} total={v.totalTests} label="You" now={now} />
          <PlayerCard
            p={theirs}
            total={v.totalTests}
            label="Opponent"
            now={now}
            testId="opponent-progress"
          />
        </div>
      </header>

      {!v.problem ? (
        <div className="grid flex-1 place-items-center text-center">
          <div>
            <p className="text-zinc-400">
              {theirs.username} ({theirs.rating}) vs you ({mine.rating})
            </p>
            <p className="mt-2 text-5xl font-bold tabular-nums">{clock(v.startsAt - now)}</p>
            <p className="mt-2 text-sm text-zinc-500">
              The problem is revealed when the countdown ends.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 gap-4 p-4 lg:grid-cols-2">
          <section className="space-y-4 overflow-auto" aria-label="Problem">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
                {v.problem.difficulty}
              </p>
              <h1 className="text-2xl font-bold" data-testid="problem-title">
                {v.problem.title}
              </h1>
              <p className="mt-1 text-xs text-zinc-500">
                Time limit {v.problem.timeLimitMs[language] / 1000}s ({LANGUAGE_LABEL[language]}) ·
                Memory {v.problem.memoryLimitMb} MB
              </p>
            </div>
            <Statement markdown={v.problem.statement} />
            {v.problem.samples.map((s, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <Sample title={`Sample ${i + 1} input`} text={s.input} />
                <Sample title="Expected output" text={s.expected} />
              </div>
            ))}
          </section>

          <section className="flex min-h-[480px] flex-col gap-3" aria-label="Editor">
            <div className="flex items-center gap-2">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
                aria-label="Language"
              >
                {Object.entries(LANGUAGE_LABEL).map(([l, label]) => (
                  <option key={l} value={l}>
                    {label}
                  </option>
                ))}
              </select>
              <div className="flex-1" />
              <button
                onClick={run}
                disabled={!live || busy !== null}
                className="rounded-md border border-zinc-700 px-4 py-1.5 text-sm hover:bg-zinc-800 disabled:opacity-50"
              >
                {busy === 'run' ? 'Running…' : 'Run samples'}
              </button>
              <button
                onClick={submit}
                disabled={!live || busy !== null}
                className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy === 'submit' ? 'Submitting…' : 'Submit'}
              </button>
            </div>
            <div className="flex-1">
              <CodeEditor language={language} value={code} onChange={setCode} />
            </div>
            {message && (
              <p className="text-sm text-zinc-400" role="status">
                {message}
              </p>
            )}
            {runResults && <RunResults sub={runResults} />}
            <MySubmissions view={v} />
          </section>
        </div>
      )}

      {v.result && <ResultOverlay result={v.result} me={me} opponent={theirs} />}
    </main>
  );
}

function PlayerCard(props: {
  p: PlayerProgress;
  total: number | null;
  label: string;
  now: number;
  testId?: string;
}) {
  const { p, total, label, now } = props;
  const pct = total ? Math.round((p.bestPassed / total) * 100) : 0;
  return (
    <div
      className="w-44 rounded-md border border-zinc-800 px-3 py-2 text-xs"
      data-testid={props.testId}
    >
      <div className="flex justify-between gap-2">
        <span className="truncate font-semibold">
          {label}: {p.username}
        </span>
        <span className={p.connected ? 'text-emerald-400' : 'text-amber-400'}>
          {p.connected ? '●' : `away ${p.graceEndsAt ? clock(p.graceEndsAt - now) : ''}`}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-zinc-800">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-zinc-400">
        <span data-testid={props.testId && `${props.testId}-passed`}>
          {p.bestPassed}/{total ?? '?'} tests
        </span>
        <span>
          {p.attempts} tries{p.pending ? ' · judging' : ''}
        </span>
      </div>
    </div>
  );
}

function Sample({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <p className="mb-1 text-xs text-zinc-500">{title}</p>
      <pre className="overflow-auto rounded-md bg-zinc-900 p-2 font-mono text-xs">{text}</pre>
    </div>
  );
}

const VERDICT_LABEL: Record<string, string> = {
  ACCEPTED: 'Accepted',
  WRONG_ANSWER: 'Wrong answer',
  TLE: 'Time limit exceeded',
  MLE: 'Memory limit exceeded',
  RUNTIME_ERROR: 'Runtime error',
  COMPILE_ERROR: 'Compile error',
};

function RunResults({ sub }: { sub: SubmissionView }) {
  if (sub.status === 'FAILED')
    return <p className="text-sm text-amber-400">The judge failed, try again.</p>;
  return (
    <div className="space-y-2 rounded-md border border-zinc-800 p-3 text-xs">
      <p className="font-semibold">
        Samples: {sub.testsPassed}/{sub.testsTotal} passed
      </p>
      {sub.compileOutput && <pre className="overflow-auto text-red-300">{sub.compileOutput}</pre>}
      {sub.tests.map((t: TestResultView) => (
        <div key={t.index} className="flex gap-2">
          <span className={t.verdict === 'ACCEPTED' ? 'text-emerald-400' : 'text-red-400'}>
            #{t.index + 1} {VERDICT_LABEL[t.verdict]}
          </span>
          {t.verdict !== 'ACCEPTED' && t.stdout !== undefined && (
            <span className="truncate text-zinc-500">
              got: {t.stdout.trim().slice(0, 80) || '(empty)'}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function MySubmissions({ view }: { view: BattleView }) {
  if (!view.mySubmissions.length) return null;
  return (
    <ul className="space-y-1 text-xs" aria-label="Your submissions" data-testid="my-submissions">
      {[...view.mySubmissions].reverse().map((s) => (
        <li key={s.id} className="flex justify-between rounded bg-zinc-900 px-2 py-1">
          <span
            className={
              s.verdict === 'ACCEPTED'
                ? 'text-emerald-400'
                : s.verdict
                  ? 'text-red-400'
                  : 'text-zinc-400'
            }
          >
            {s.status === 'DONE'
              ? VERDICT_LABEL[s.verdict!]
              : s.status === 'FAILED'
                ? 'Judge error'
                : 'Judging…'}
          </span>
          <span className="text-zinc-500">
            {s.testsPassed ?? '–'}/{s.testsTotal ?? view.totalTests} · {LANGUAGE_LABEL[s.language]}
          </span>
        </li>
      ))}
    </ul>
  );
}

const REASON: Record<MatchResult['endReason'], string> = {
  SOLVED: 'first to solve every test',
  TIMEOUT: 'decided on tests passed when time ran out',
  FORFEIT: 'opponent disconnected',
  ABANDONED: 'both players disconnected',
};

function ResultOverlay({
  result,
  me,
  opponent,
}: {
  result: MatchResult;
  me?: string;
  opponent: PlayerProgress;
}) {
  const headline =
    result.status === 'ABORTED'
      ? 'Match aborted'
      : result.winnerId === null
        ? 'Draw'
        : result.winnerId === me
          ? 'You won!'
          : 'You lost';
  const reason =
    result.endReason === 'FORFEIT' && result.winnerId !== me
      ? 'you were disconnected too long'
      : REASON[result.endReason];
  return (
    <div
      className="fixed inset-0 grid place-items-center bg-black/70 p-4"
      role="dialog"
      aria-label="Match result"
    >
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
        <p className="text-3xl font-bold" data-testid="battle-result">
          {headline}
        </p>
        <p className="mt-2 text-sm text-zinc-400" data-testid="battle-result-reason">
          vs {opponent.username}: {reason}
        </p>
        {(() => {
          const mine = result.ratingChanges?.find((c) => c.userId === me);
          return mine ? (
            <p className="mt-4 font-mono text-lg" data-testid="rating-change">
              {mine.before} → <span className="font-semibold text-zinc-100">{mine.after}</span>{' '}
              <span className="text-zinc-400">
                ({mine.delta > 0 ? '+' : ''}
                {mine.delta})
              </span>
            </p>
          ) : result.status === 'ABORTED' ? (
            <p className="mt-4 text-sm text-zinc-500">Unrated: ratings are unchanged.</p>
          ) : null;
        })()}
        <Link
          to="/play"
          className="mt-6 inline-block rounded-md bg-emerald-600 px-4 py-2 font-semibold hover:bg-emerald-500"
        >
          Back to lobby
        </Link>
      </div>
    </div>
  );
}
