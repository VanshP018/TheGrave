import type { InterviewQuestionView, InterviewSummary } from '@thegrave/shared';
import { card } from '../ui';
import { DIFF } from '../play/PracticeList';
import { EvidenceSnippet } from './EvidenceSnippet';
import { CATEGORY_LABEL, evidenceUrl } from './labels';

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <details className="group border-t border-ash-700 pt-3">
      <summary className="cursor-pointer select-none text-sm text-ash-300 transition-colors hover:text-ink">
        {title}
      </summary>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ash-300">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </details>
  );
}

export function QuestionCard({
  q,
  n,
  repo,
}: {
  q: InterviewQuestionView;
  n: number;
  repo: Pick<InterviewSummary, 'owner' | 'repo' | 'commitSha'>;
}) {
  const diff = DIFF[q.difficulty];
  return (
    <article className={`${card} space-y-4 p-5 sm:p-6`} data-testid="question-card">
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono text-ash-400">{String(n).padStart(2, '0')}</span>
        <span className="rounded-full bg-white/[0.08] px-2.5 py-1 text-ash-300">
          {CATEGORY_LABEL[q.category]}
        </span>
        <span className={`font-medium ${diff.tone}`}>{diff.label}</span>
      </header>
      <p className="whitespace-pre-line text-[17px] leading-relaxed text-ink">{q.question}</p>
      <p className="text-sm text-ash-300">
        <span className="text-ash-400">Why we ask: </span>
        {q.whyAsked}
      </p>
      {q.evidence.map((e, i) => (
        <EvidenceSnippet key={i} e={e} href={evidenceUrl(repo, e)} />
      ))}
      <div className="space-y-3">
        <Section title="What a strong answer covers" items={q.strongAnswer} />
        <Section title="Follow-up probes" items={q.followUps} />
        <Section title="Red flags" items={q.redFlags} />
      </div>
    </article>
  );
}
