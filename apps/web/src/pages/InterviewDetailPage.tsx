import {
  INTERVIEW_CATEGORIES,
  INTERVIEW_ERROR_MESSAGES,
  type Difficulty,
  type InterviewCategory,
} from '@thegrave/shared';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AppShell } from '../components/AppShell';
import { StatusPill } from '../components/interviews/AnalysisList';
import {
  CATEGORY_LABEL,
  levelText,
  repoUrl,
  stageLabel,
  toMarkdown,
} from '../components/interviews/labels';
import { ProgressSteps } from '../components/interviews/ProgressSteps';
import { QuestionCard } from '../components/interviews/QuestionCard';
import { DIFF } from '../components/play/PracticeList';
import { btnPrimary, btnSecondary, card, focusRing, PageHeader } from '../components/ui';
import { ApiRequestError } from '../lib/api';
import { useCreateInterview, useDeleteInterview, useInterview } from '../lib/interviews';

const chip = (on: boolean) =>
  `h-9 shrink-0 cursor-pointer rounded-full px-3.5 text-sm transition-colors ${focusRing} ${
    on
      ? 'bg-azure/15 text-azure-light ring-1 ring-azure/40'
      : 'bg-white/[0.05] text-ash-300 hover:bg-white/[0.08] hover:text-ink'
  }`;

function Message({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <section className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <div className={`${card} p-6 text-ash-300`}>{children}</div>
        <Link to="/interviews" className={`${btnSecondary} mt-6`}>
          Back to interviews
        </Link>
      </section>
    </AppShell>
  );
}

/** One analysis: progress while it runs, the question set when done, an error card if it failed. */
export default function InterviewDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: d, error, isPending } = useInterview(id);
  const remove = useDeleteInterview();
  const retry = useCreateInterview();
  const [category, setCategory] = useState<InterviewCategory | 'ALL'>('ALL');
  const [difficulty, setDifficulty] = useState<Difficulty | 'ALL'>('ALL');
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  const present = useMemo(
    () => INTERVIEW_CATEGORIES.filter((c) => d?.questions.some((q) => q.category === c)),
    [d],
  );

  if (isPending)
    return (
      <AppShell>
        <div className="min-h-[40vh]" />
      </AppShell>
    );
  if (!d) {
    const missing = error instanceof ApiRequestError && error.status === 404;
    return (
      <Message>{missing ? 'That analysis was not found.' : 'Couldn’t load this analysis.'}</Message>
    );
  }

  const shown = d.questions
    .map((q, i) => ({ q, n: i + 1 }))
    .filter(
      ({ q }) =>
        (category === 'ALL' || q.category === category) &&
        (difficulty === 'ALL' || q.difficulty === difficulty),
    );
  const name = `${d.owner}/${d.repo}`;
  const retrying = d.status === 'QUEUED' && !!d.progress?.waitingUntil;
  const languages = d.profile?.languages.slice(0, 3) ?? [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(d));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  };

  return (
    <AppShell>
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <Link to="/interviews" className={`text-sm text-ash-300 hover:text-ink ${focusRing}`}>
          ← All analyses
        </Link>
        <div className="mt-4 max-w-3xl">
          <PageHeader eyebrow="Interview set" title={<span className="break-all">{name}</span>}>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <a
                href={d.commitSha ? `${repoUrl(d)}/tree/${d.commitSha}` : repoUrl(d)}
                target="_blank"
                rel="noreferrer noopener"
                className={`rounded-sm text-azure hover:text-azure-light ${focusRing}`}
              >
                View on GitHub{d.commitSha ? ` @ ${d.commitSha.slice(0, 7)}` : ''} ↗
              </a>
              <span className="rounded-full bg-white/[0.08] px-2.5 py-0.5 text-xs">
                {levelText(d)}
              </span>
              {languages.map((l) => (
                <span key={l.name} className="rounded-full bg-white/[0.05] px-2.5 py-0.5 text-xs">
                  {l.name}
                </span>
              ))}
              <StatusPill status={d.status} retrying={retrying} />
            </span>
          </PageHeader>
          {d.profile?.summary && (
            <p className="mt-4 text-[15px] font-light leading-relaxed text-ash-300">
              {d.profile.summary}
            </p>
          )}
        </div>

        <div className="mt-8 max-w-3xl">
          {(d.status === 'QUEUED' || d.status === 'RUNNING') && <ProgressSteps d={d} />}

          {d.status === 'FAILED' && (
            <div role="alert" className={`${card} border-red-400/30 p-5 sm:p-6`}>
              <p className="text-ink">{INTERVIEW_ERROR_MESSAGES[d.errorCode ?? 'INTERNAL']}</p>
              {d.stage !== 'QUEUED' && d.stage !== 'DONE' && (
                <p className="mt-1 text-sm text-ash-400">Failed while: {stageLabel(d.stage)}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={retry.isPending}
                  onClick={() =>
                    retry.mutate(
                      { repoUrl: repoUrl(d), level: d.requestedLevel },
                      { onSuccess: ({ id: next }) => void navigate(`/interviews/${next}`) },
                    )
                  }
                  className={btnPrimary}
                >
                  Try again
                </button>
                <Link to="/interviews" className={btnSecondary}>
                  Back
                </Link>
              </div>
              {retry.isError && (
                <p className="mt-3 text-sm text-red-400">
                  {retry.error instanceof ApiRequestError
                    ? retry.error.body.message
                    : 'Could not start a new analysis.'}
                </p>
              )}
            </div>
          )}
        </div>

        {d.status === 'DONE' && (
          <>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
              <div className="-mx-4 flex max-w-full gap-2 overflow-x-auto whitespace-nowrap px-4 sm:mx-0 sm:flex-wrap sm:px-0">
                <button
                  aria-pressed={category === 'ALL'}
                  onClick={() => setCategory('ALL')}
                  className={chip(category === 'ALL')}
                >
                  All
                </button>
                {present.map((c) => (
                  <button
                    key={c}
                    aria-pressed={category === c}
                    onClick={() => setCategory(c)}
                    className={chip(category === c)}
                  >
                    {CATEGORY_LABEL[c]}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void copy()} className={btnSecondary}>
                  {copied ? 'Copied' : 'Copy as Markdown'}
                </button>
                {confirming ? (
                  <span className="flex items-center gap-2 text-sm">
                    <span className="text-ash-300">Delete?</span>
                    <button
                      type="button"
                      disabled={remove.isPending}
                      onClick={() =>
                        remove.mutate(d.id, { onSuccess: () => void navigate('/interviews') })
                      }
                      className={`${btnSecondary} border-red-400/40 text-red-400`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      className={btnSecondary}
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className={btnSecondary}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Difficulty">
              {(['ALL', 'EASY', 'MEDIUM', 'HARD'] as const).map((df) => (
                <button
                  key={df}
                  aria-pressed={difficulty === df}
                  onClick={() => setDifficulty(df)}
                  className={chip(difficulty === df)}
                >
                  {df === 'ALL' ? 'All levels' : DIFF[df].label}
                </button>
              ))}
            </div>

            {d.questions.length < 8 && (
              <p className="mt-4 text-sm text-ash-400">
                We kept only questions we could tie to your code.
              </p>
            )}
            <div className="mt-5 max-w-3xl space-y-4">
              {shown.map(({ q, n }) => (
                <QuestionCard key={q.position} q={q} n={n} repo={d} />
              ))}
              {shown.length === 0 && (
                <p className="text-sm text-ash-300">No questions match these filters.</p>
              )}
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
