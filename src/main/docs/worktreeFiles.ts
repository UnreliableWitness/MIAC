import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GitClient } from '../services/GitClient';

export const MAX_DOC_BYTES = 2 * 1024 * 1024;
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
export const MAX_DOCS = 2000;
export const TASK_FILE = '.miac/task.md';
const SPECS = [':(icase)*.md', ':(icase)*.markdown'];
const MD = /\.(md|markdown)$/i;
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export type DocFile = { path: string; changed: 'new' | 'modified' | null };

/** True when `target` is `root` or inside it; Windows paths compare case-insensitively. */
export function isInside(
  root: string,
  target: string,
  p: typeof path = path,
): boolean {
  const norm = (x: string) => (p.sep === '\\' ? x.toLowerCase() : x);
  const r = norm(p.resolve(root));
  const t = norm(p.resolve(target));
  if (t === r) return true;
  return t.startsWith(r.endsWith(p.sep) ? r : r + p.sep);
}

export const toRel = (root: string, abs: string): string =>
  path.relative(root, abs).split(path.sep).join('/');

/** The real path of a regular file inside the worktree, after following symlinks. */
export async function resolveInWorktree(
  worktree: string,
  rel: string,
): Promise<string> {
  if (!rel || rel.includes('\0')) throw new Error('Outside the worktree');
  const lexical = path.resolve(worktree);
  const root = await fs.realpath(worktree);
  // An absolute path printed in a terminal uses the worktree path as MIAC knows it, which may differ from its realpath (macOS /var).
  const joined = path.isAbsolute(rel)
    ? isInside(lexical, rel)
      ? path.join(root, path.relative(lexical, rel))
      : path.resolve(rel)
    : path.resolve(root, rel);
  if (!isInside(root, joined)) throw new Error('Outside the worktree');
  let real: string;
  try {
    real = await fs.realpath(joined);
  } catch {
    throw new Error('Not found');
  }
  if (!isInside(root, real)) throw new Error('Outside the worktree');
  const st = await fs.stat(real);
  if (!st.isFile()) throw new Error('Not found');
  return real;
}

const splitZ = (out: string) => out.split('\0').filter(Boolean);

export async function listDocs(
  git: GitClient,
  worktree: string,
  baseSha: string | null,
): Promise<DocFile[]> {
  const listed = splitZ(
    await git.run(worktree, [
      'ls-files',
      '-z',
      '-co',
      '--exclude-standard',
      '--',
      ...SPECS,
    ]),
  ).filter((p) => MD.test(p));
  const changed = new Map<string, 'new' | 'modified'>();
  if (baseSha) {
    const diff = splitZ(
      await git
        .run(worktree, [
          'diff',
          '-z',
          '--name-status',
          '--no-renames',
          baseSha,
          '--',
          ...SPECS,
        ])
        .catch(() => ''),
    );
    for (let i = 0; i + 1 < diff.length; i += 2) {
      const status = diff[i][0];
      if (status === 'A') changed.set(diff[i + 1], 'new');
      else if (status === 'M' || status === 'T')
        changed.set(diff[i + 1], 'modified');
    }
    const untracked = splitZ(
      await git.run(worktree, [
        'ls-files',
        '-z',
        '-o',
        '--exclude-standard',
        '--',
        ...SPECS,
      ]),
    );
    for (const p of untracked) changed.set(p, 'new');
  }
  // -c also lists files deleted from the working tree but still in the index.
  const present = await Promise.all(
    [...new Set(listed)].map(async (p) =>
      (await fs.stat(path.join(worktree, p)).then(
        (s) => s.isFile(),
        () => false,
      ))
        ? p
        : null,
    ),
  );
  const files = present
    .filter((p): p is string => p !== null && p !== TASK_FILE)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((p) => ({ path: p, changed: changed.get(p) ?? null }));
  const hasTask = await fs.stat(path.join(worktree, TASK_FILE)).then(
    (s) => s.isFile(),
    () => false,
  );
  const all = hasTask ? [{ path: TASK_FILE, changed: null }, ...files] : files;
  return all.slice(0, MAX_DOCS);
}

export async function readDoc(
  worktree: string,
  rel: string,
): Promise<{ text: string; mtimeMs: number }> {
  const abs = await resolveInWorktree(worktree, rel);
  const st = await fs.stat(abs);
  if (st.size > MAX_DOC_BYTES) throw new Error('Too large');
  return { text: await fs.readFile(abs, 'utf8'), mtimeMs: st.mtimeMs };
}

export async function readAsset(
  worktree: string,
  rel: string,
): Promise<string> {
  const abs = await resolveInWorktree(worktree, rel);
  const type = IMAGE_TYPES[path.extname(abs).toLowerCase()];
  if (!type) throw new Error('Not an image');
  const st = await fs.stat(abs);
  if (st.size > MAX_ASSET_BYTES) throw new Error('Too large');
  return `data:${type};base64,${(await fs.readFile(abs)).toString('base64')}`;
}

export async function resolveLink(
  worktree: string,
  rel: string,
): Promise<{ path: string; kind: 'md' | 'file' } | null> {
  try {
    const abs = await resolveInWorktree(worktree, rel);
    const root = await fs.realpath(worktree);
    return { path: toRel(root, abs), kind: MD.test(abs) ? 'md' : 'file' };
  } catch {
    return null;
  }
}
