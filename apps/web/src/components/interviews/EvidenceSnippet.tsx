import type { InterviewEvidence } from '@thegrave/shared';
import { focusRing } from '../ui';
import { lineRange } from './labels';

/** One cited file range: the server's copy of the real lines, line-numbered, with a link to GitHub. */
export function EvidenceSnippet({ e, href }: { e: InterviewEvidence; href: string | null }) {
  const lines = e.snippet.replace(/\n$/, '').split('\n');
  const label = `${e.path} lines ${e.startLine} to ${e.endLine}`;
  return (
    <figure className="min-w-0 overflow-hidden rounded-lg border border-ash-700 bg-ash-900">
      <figcaption className="flex flex-wrap items-center gap-x-3 border-b border-ash-700 px-3 py-2 text-xs">
        <code className="break-all text-ash-300">{e.path}</code>
        <span className="text-ash-400">{lineRange(e)}</span>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Open ${label} on GitHub`}
            className={`ml-auto rounded-sm text-azure hover:text-azure-light ${focusRing}`}
          >
            GitHub ↗
          </a>
        )}
      </figcaption>
      <pre className="overflow-x-auto py-2 font-mono text-xs leading-5 text-ash-300">
        {lines.map((line, i) => (
          <div key={i} className="flex px-3">
            <span aria-hidden className="mr-3 w-8 shrink-0 select-none text-right text-ash-500">
              {e.startLine + i}
            </span>
            <code className="whitespace-pre">{line}</code>
          </div>
        ))}
      </pre>
    </figure>
  );
}
