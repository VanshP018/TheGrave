import type { ReactNode } from 'react';

/** Inline `code` only. Builds React nodes, never HTML strings, so statement text can't inject markup. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <code
        key={i}
        className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[0.9em] text-emerald-300"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

/** The tiny Markdown subset our statements use: `###` headings, `- ` lists, paragraphs, inline code. */
export function Statement({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={blocks.length} className="list-disc space-y-1 pl-5">
        {list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  for (const line of markdown.split('\n')) {
    if (line.startsWith('- ')) {
      list.push(line.slice(2));
      continue;
    }
    flush();
    if (line.startsWith('### ')) {
      blocks.push(
        <h3
          key={blocks.length}
          className="pt-2 text-sm font-semibold uppercase tracking-wide text-zinc-400"
        >
          {line.slice(4)}
        </h3>,
      );
    } else if (line.trim()) {
      blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="space-y-3 leading-relaxed text-zinc-200">{blocks}</div>;
}
