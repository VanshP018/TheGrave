/** File helpers for the workspace (decision.md D-066). */

export const languageFor = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return (
    (
      {
        py: 'python',
        js: 'javascript',
        mjs: 'javascript',
        cjs: 'javascript',
        json: 'javascript',
        md: 'markdown',
        sh: 'shell',
      } as Record<string, string>
    )[ext] ?? 'plaintext'
  );
};

/** A short badge for the file tree and tabs, coloured per type. */
export const fileBadge = (path: string): { text: string; tone: string } => {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'py') return { text: 'PY', tone: 'text-[#8ab8e6]' };
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return { text: 'JS', tone: 'text-[#f0db4f]' };
  if (ext === 'json') return { text: '{}', tone: 'text-orange-300' };
  if (ext === 'md') return { text: 'M↓', tone: 'text-azure-light' };
  return { text: '··', tone: 'text-ash-400' };
};

export interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
}

/** Paths → a sorted tree: folders first, then files, each alphabetically. */
export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] };
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');
      let child = node.children!.find((c) => c.name === part && !!c.children === !isFile);
      if (!child) {
        child = isFile ? { name: part, path } : { name: part, path, children: [] };
        node.children!.push(child);
      }
      node = child;
    });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => Number(!a.children) - Number(!b.children) || a.name.localeCompare(b.name))
      .map((n) => (n.children ? { ...n, children: sort(n.children) } : n));
  return sort(root.children!);
}
