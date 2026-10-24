import { useState } from 'react';
import { ChevronIcon } from '../battle/icons';
import { focusRing } from '../ui';
import { buildTree, fileBadge, type TreeNode } from './files';

function Node(props: {
  node: TreeNode;
  depth: number;
  active: string;
  modified: Set<string>;
  onOpen: (path: string) => void;
}) {
  const { node, depth, active, modified, onOpen } = props;
  const [open, setOpen] = useState(true);
  const pad = { paddingLeft: `${12 + depth * 14}px` };

  if (node.children) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          style={pad}
          className={`flex h-8 w-full cursor-pointer items-center gap-1.5 pr-2 text-left text-[13px] text-ash-300 transition-colors hover:bg-white/[0.04] hover:text-ink ${focusRing}`}
        >
          <ChevronIcon
            className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
          />
          <span className="truncate">{node.name}</span>
        </button>
        {open && (
          <ul>
            {node.children.map((c) => (
              <Node key={c.path} {...props} node={c} depth={depth + 1} />
            ))}
          </ul>
        )}
      </li>
    );
  }
  const badge = fileBadge(node.path);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(node.path)}
        aria-current={active === node.path ? 'true' : undefined}
        aria-label={node.path}
        style={pad}
        title={node.path}
        className={`flex h-8 w-full cursor-pointer items-center gap-2 pr-3 text-left text-[13px] transition-colors ${focusRing} ${
          active === node.path
            ? 'bg-azure/10 text-ink'
            : 'text-ash-300 hover:bg-white/[0.04] hover:text-ink'
        }`}
      >
        <span
          aria-hidden
          className={`w-5 shrink-0 text-center font-mono text-[10px] font-bold ${badge.tone}`}
        >
          {badge.text}
        </span>
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        {modified.has(node.path) && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-azure" title="Modified" />
        )}
      </button>
    </li>
  );
}

/** The project's files as a collapsible tree; a dot marks files that differ from the starter. */
export function FileTree(props: {
  paths: string[];
  active: string;
  modified: Set<string>;
  onOpen: (path: string) => void;
}) {
  return (
    <ul aria-label="Files" className="py-1">
      {buildTree(props.paths).map((n) => (
        <Node key={n.path} node={n} depth={0} {...props} />
      ))}
    </ul>
  );
}
