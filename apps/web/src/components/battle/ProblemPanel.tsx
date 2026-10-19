import type { Language, ProblemDetail } from '@thegrave/shared';
import { useState } from 'react';
import { CheckIcon, CopyIcon } from './icons';
import { SectionTitle, Statement } from './Statement';

export const LANGUAGE_LABEL: Record<Language, string> = { python: 'Python 3', cpp: 'C++17' };

const DIFFICULTY: Record<ProblemDetail['difficulty'], string> = {
  EASY: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  MEDIUM: 'border-orange-500/30 bg-orange-500/10 text-orange-400',
  HARD: 'border-red-500/30 bg-red-500/10 text-red-400',
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="grid h-7 w-7 cursor-pointer place-items-center rounded-sm text-ash-400 transition-colors hover:bg-ash-700 hover:text-ink"
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function Example({ n, input, expected }: { n: number; input: string; expected: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-ash-700 bg-hero-bg/60">
      {[
        { title: 'Input', text: input },
        { title: 'Output', text: expected },
      ].map((part, i) => (
        <div key={part.title} className={i ? 'border-t border-ash-800' : ''}>
          <div className="flex items-center justify-between pl-4 pr-1.5 pt-1.5">
            <span className="text-xs font-semibold text-ash-300">{part.title}</span>
            <CopyButton text={part.text} label={`Copy example ${n} ${part.title.toLowerCase()}`} />
          </div>
          <pre className="overflow-x-auto px-4 pb-3 font-mono text-[13px] leading-6 text-ink">
            {part.text}
          </pre>
        </div>
      ))}
    </div>
  );
}

export function ProblemPanel({
  problem,
  language,
}: {
  problem: ProblemDetail;
  language: Language;
}) {
  return (
    <article className="space-y-4 px-5 py-5 sm:px-6">
      <header className="space-y-3">
        <h1
          className="text-xl font-semibold tracking-[-0.01em] text-ink"
          data-testid="problem-title"
        >
          {problem.title}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded-sm border px-2 py-0.5 font-medium capitalize ${DIFFICULTY[problem.difficulty]}`}
          >
            {problem.difficulty.toLowerCase()}
          </span>
          <span className="h-1 w-1 rounded-full bg-ash-600" aria-hidden />
          <span className="text-ash-400">
            Time limit {problem.timeLimitMs[language] / 1000}s ({LANGUAGE_LABEL[language]})
          </span>
          <span className="h-1 w-1 rounded-full bg-ash-600" aria-hidden />
          <span className="text-ash-400">Memory {problem.memoryLimitMb} MB</span>
        </div>
      </header>

      <Statement markdown={problem.statement} />

      {problem.samples.map((s, i) => (
        <section key={i} className="space-y-3">
          <SectionTitle>{problem.samples.length > 1 ? `Example ${i + 1}` : 'Example'}</SectionTitle>
          <Example n={i + 1} input={s.input} expected={s.expected} />
        </section>
      ))}
    </article>
  );
}
