import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GitClient } from '../services/GitClient';
import type { LeakMatcher } from './LeakMatcher';

/** Untracked files bigger than this are not read for the Changes flag (the diff view does not show them either). */
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024;

/** A path as git prints it in a header: C-quoted when it has special characters (octal escapes are UTF-8 bytes). */
function unquote(p: string): string {
  if (!p.startsWith('"')) return p;
  const bytes: number[] = [];
  const simple: Record<string, number> = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    '"': 34,
    '\\': 92,
  };
  const s = p.slice(1, -1);
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf8'));
      continue;
    }
    const n = s[i + 1] ?? '';
    if (/[0-7]/.test(n)) {
      bytes.push(parseInt(s.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(simple[n] ?? n.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** The added lines of a unified diff (made with `a/` and `b/` prefixes), per path on the new side. */
export function parseAddedLines(diff: string): Map<string, string> {
  const out = new Map<string, string>();
  let file: string | null = null;
  let inHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = null;
      inHunk = false;
    } else if (!inHunk && line.startsWith('+++ ')) {
      const p = unquote(line.slice(4));
      file = p === '/dev/null' ? null : p.replace(/^b\//, '');
    } else if (line.startsWith('@@')) inHunk = true;
    else if (inHunk && file !== null && line.startsWith('+'))
      out.set(file, `${out.get(file) ?? ''}${line.slice(1)}\n`);
  }
  return out;
}

/** The lines `refs` add (one range like `base...HEAD`, or a ref against the working tree), per path. */
export async function addedLines(
  git: GitClient,
  worktree: string,
  refs: string[],
): Promise<Map<string, string>> {
  const diff = await git.run(worktree, [
    '--no-optional-locks',
    '-c',
    'core.quotepath=off',
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '-U0',
    '-M',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    ...refs,
    '--',
  ]);
  return parseAddedLines(diff);
}

/**
 * The paths whose added lines hold a stored value: lines the diff adds, and whole files for the `untracked` paths
 * (repo-relative, read from the worktree) the diff does not list.
 */
export async function pathsWithLeaks(
  git: GitClient,
  worktree: string,
  refs: string[],
  matcher: LeakMatcher,
  untracked: string[] = [],
): Promise<Set<string>> {
  const found = new Set<string>();
  if (matcher.empty) return found;
  const added = await addedLines(git, worktree, refs);
  for (const [p, text] of added)
    if (matcher.find(text).length > 0) found.add(p);
  for (const p of untracked) {
    if (added.has(p)) continue;
    const full = path.join(worktree, p);
    const st = await fs.stat(full).catch(() => null);
    if (!st?.isFile() || st.size > MAX_UNTRACKED_BYTES) continue;
    const text = await fs.readFile(full, 'utf8').catch(() => '');
    if (matcher.find(text).length > 0) found.add(p);
  }
  return found;
}

/** Whether the commits a push would send (`base...HEAD`) add a stored value. */
export async function branchLeaks(
  git: GitClient,
  worktree: string,
  base: string,
  matcher: LeakMatcher,
): Promise<boolean> {
  if (matcher.empty) return false;
  return (
    (await pathsWithLeaks(git, worktree, [`${base}...HEAD`], matcher)).size > 0
  );
}
