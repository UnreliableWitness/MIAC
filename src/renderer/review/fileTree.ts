import type { ReviewFile } from '../../shared/review';

/** A folder of the Changes tree; `name` holds the folders a chain of single folders compacts into. */
export type TreeDir = {
  /** The folder's full path, no trailing slash ('' for the root). */
  path: string;
  name: string;
  dirs: TreeDir[];
  files: ReviewFile[];
};

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** The files as a folder tree: folders before files, both by name, single-folder chains compacted (a/b/c). */
export function buildTree(files: ReviewFile[]): TreeDir {
  const root: TreeDir = { path: '', name: '', dirs: [], files: [] };
  const dirs = new Map<string, TreeDir>([['', root]]);
  const dirOf = (path: string): TreeDir => {
    const found = dirs.get(path);
    if (found) return found;
    const i = path.lastIndexOf('/');
    const parent = dirOf(i < 0 ? '' : path.slice(0, i));
    const dir: TreeDir = { path, name: base(path), dirs: [], files: [] };
    parent.dirs.push(dir);
    dirs.set(path, dir);
    return dir;
  };
  for (const f of files) {
    const i = f.path.lastIndexOf('/');
    dirOf(i < 0 ? '' : f.path.slice(0, i)).files.push(f);
  }
  const finish = (d: TreeDir): TreeDir => {
    let dir = d;
    // A folder holding just one folder joins it, as VS Code's compact folders do.
    while (dir.path !== '' && dir.files.length === 0 && dir.dirs.length === 1) {
      const only = dir.dirs[0];
      dir = { ...only, name: `${dir.name}/${only.name}` };
    }
    return {
      ...dir,
      dirs: dir.dirs.map(finish).sort((a, b) => byName(a.name, b.name)),
      files: [...dir.files].sort((a, b) => byName(base(a.path), base(b.path))),
    };
  };
  return finish(root);
}

/** Every file under a folder, in the order the tree shows them. */
export function treeFiles(dir: TreeDir): ReviewFile[] {
  return [...dir.dirs.flatMap(treeFiles), ...dir.files];
}

/** Whether the folder at `dirPath` holds `filePath`, at any depth. */
export const holds = (dirPath: string, filePath: string): boolean =>
  dirPath === '' || filePath.startsWith(`${dirPath}/`);

/** The key a folded folder is kept under, per repo. */
export const dirKey = (workspaceId: string, dirPath: string): string =>
  `${workspaceId}::${dirPath}`;

/** A repo's files in the order the Files panel shows them. */
export const viewOrder = (
  files: ReviewFile[],
  view: 'tree' | 'list',
): ReviewFile[] => (view === 'tree' ? treeFiles(buildTree(files)) : files);
