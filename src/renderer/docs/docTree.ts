import type { SessionDoc } from '../../shared/types';

export type TreeFile = {
  kind: 'file';
  key: string;
  name: string;
  doc: SessionDoc;
};
export type TreeFolder = {
  kind: 'folder';
  key: string;
  name: string;
  /** A root: a workspace (its repo name) or a folder outside every worktree (its absolute path). */
  root: boolean;
  children: TreeNode[];
};
export type TreeNode = TreeFile | TreeFolder;

const byName = (a: TreeNode, b: TreeNode) =>
  a.kind !== b.kind
    ? a.kind === 'folder'
      ? -1
      : 1
    : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** The parent folder of an absolute "/" path ("C:/x/a.md" gives "C:/x", "/a.md" gives "/"). */
export function parentDir(p: string): string {
  const i = p.lastIndexOf('/');
  if (i <= 0) return '/';
  const dir = p.slice(0, i);
  return /^[A-Za-z]:$/.test(dir) ? `${dir}/` : dir;
}

/**
 * Session docs as a tree: a root per workspace (named by `rootName`, in `order`) with its folders, then a root per
 * folder outside the worktrees (its absolute path, sorted). Inside a folder: subfolders first, then files, each
 * alphabetical. A folder whose only child is a folder is shown as one ("docs/specs").
 */
export function buildDocTree(
  docs: SessionDoc[],
  order: string[],
  rootName: (workspaceId: string) => string,
): TreeFolder[] {
  const roots = new Map<string, TreeFolder>();
  const folder = (parent: TreeFolder, name: string): TreeFolder => {
    const key = `${parent.key}/${name}`;
    let f = parent.children.find(
      (c): c is TreeFolder => c.kind === 'folder' && c.key === key,
    );
    if (!f) {
      f = { kind: 'folder', key, name, root: false, children: [] };
      parent.children.push(f);
    }
    return f;
  };
  for (const doc of docs) {
    const [rootKey, name, rel] =
      doc.workspaceId !== null
        ? [`ws:${doc.workspaceId}`, rootName(doc.workspaceId), doc.path]
        : (() => {
            const dir = parentDir(doc.path);
            return [
              `dir:${dir}`,
              dir,
              doc.path.slice(dir.replace(/\/$/, '').length + 1),
            ];
          })();
    let root = roots.get(rootKey);
    if (!root) {
      root = { kind: 'folder', key: rootKey, name, root: true, children: [] };
      roots.set(rootKey, root);
    }
    const parts = rel.split('/');
    let at = root;
    for (const p of parts.slice(0, -1)) at = folder(at, p);
    at.children.push({
      kind: 'file',
      key: `${rootKey}:${doc.path}`,
      name: parts[parts.length - 1],
      doc,
    });
  }
  const finish = (f: TreeFolder): TreeFolder => {
    let node = f;
    // Compact a chain of single-folder folders (never a root into its child).
    while (
      !node.root &&
      node.children.length === 1 &&
      node.children[0].kind === 'folder'
    ) {
      const only = node.children[0];
      node = { ...only, name: `${node.name}/${only.name}` };
    }
    return {
      ...node,
      children: node.children
        .map((c) => (c.kind === 'folder' ? finish(c) : c))
        .sort(byName),
    };
  };
  const rank = (k: string) => {
    const i = order.indexOf(k.slice(3));
    return k.startsWith('ws:') ? (i < 0 ? order.length : i) : order.length + 1;
  };
  return [...roots.values()]
    .sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name))
    .map(finish);
}
