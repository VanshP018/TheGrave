import { useNavigate } from 'react-router';
import { AppShell } from '../components/AppShell';
import { AnalysisList } from '../components/interviews/AnalysisList';
import { RepoForm } from '../components/interviews/RepoForm';
import { card, PageHeader } from '../components/ui';
import { isActive, useInterviews } from '../lib/interviews';

const STEPS = [
  'Paste a public GitHub repo',
  'We read about 20 key files',
  'You get questions with the exact lines they come from',
];

/** Interview prep: paste a repo, then browse earlier analyses (plan.md 2.1). */
export function InterviewsPage() {
  const navigate = useNavigate();
  const { data, isPending, isError, refetch } = useInterviews();
  const items = data?.items ?? [];
  const blocked =
    !!data &&
    (!data.enabled ||
      data.capacity.available === false ||
      data.quota.used >= data.quota.limit ||
      items.some((i) => isActive(i.status)));

  return (
    <AppShell>
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <div className="max-w-2xl">
          <PageHeader eyebrow="Interviews" title="Interview questions from your own code">
            Paste a public GitHub repo. We read the parts an interviewer would, then ask what they’d
            ask.
          </PageHeader>
        </div>

        <div className="mt-8 max-w-3xl">
          <RepoForm data={data} />
        </div>

        <h2 className="mt-10 text-lg font-semibold tracking-tight text-ink">Your analyses</h2>
        <div className="max-w-3xl">
          {isPending ? (
            <div className={`${card} mt-3 h-20 animate-pulse`} aria-label="Loading analyses" />
          ) : isError ? (
            <p role="alert" className="mt-3 text-sm text-ash-300">
              Couldn’t load your analyses.{' '}
              <button
                onClick={() => void refetch()}
                className="cursor-pointer text-azure underline"
              >
                Retry
              </button>
            </p>
          ) : items.length === 0 ? (
            <ol className={`${card} mt-3 space-y-3 p-5 text-sm text-ash-300`}>
              {STEPS.map((t, i) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-azure/15 text-xs text-azure-light">
                    {i + 1}
                  </span>
                  {t}
                </li>
              ))}
            </ol>
          ) : (
            <AnalysisList
              items={items}
              blocked={blocked}
              onRetried={(id) => void navigate(`/interviews/${id}`)}
            />
          )}
        </div>
      </section>
    </AppShell>
  );
}
