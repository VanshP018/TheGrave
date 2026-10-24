import type { ReactNode } from 'react';

/** Inline `code` and **bold** only. Builds React nodes, never HTML strings, so statement text can't inject markup. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <code
        key={i}
        className="rounded-sm border border-ash-700 bg-ash-800 px-1.5 py-px font-mono text-[0.85em] text-azure-light"
      >
        {part.slice(1, -1)}
      </code>
    ) : part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-ink">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

/** Section title with a hairline running to the panel edge. Shared with the examples below the statement. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-3 pt-4 text-[15px] font-semibold text-ink after:h-px after:flex-1 after:bg-ash-700">
      {children}
    </h3>
  );
}

/**
 * The tiny Markdown subset our statements use: `#`–`###` headings, `- ` lists, fenced code blocks,
 * paragraphs, inline code, bold.
 */
export function Statement({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={blocks.length} className="list-disc space-y-1.5 pl-5 marker:text-azure/70">
        {list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  let fence: string[] | null = null;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) {
      if (fence) {
        blocks.push(
          <pre
            key={blocks.length}
            className="overflow-x-auto rounded-md border border-ash-700 bg-hero-bg/60 px-4 py-3 font-mono text-[13px] leading-6 text-ink"
          >
            {fence.join('\n')}
          </pre>,
        );
        fence = null;
      } else {
        flush();
        fence = [];
      }
      continue;
    }
    if (fence) {
      fence.push(line);
      continue;
    }
    if (line.startsWith('- ')) {
      list.push(line.slice(2));
      continue;
    }
    flush();
    const heading = line.match(/^#{1,3} (.*)$/);
    if (heading) {
      blocks.push(<SectionTitle key={blocks.length}>{heading[1]}</SectionTitle>);
    } else if (line.trim()) {
      blocks.push(<p key={blocks.length}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="space-y-3 text-[15px] leading-7 text-ink/90">{blocks}</div>;
}
