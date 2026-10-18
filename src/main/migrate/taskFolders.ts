import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathExists } from '../fsRetry';

/** Worktrees made before the rename keep their task file in `.miac/`; move it to `.shellie/` so the Docs tab and Claude's prompt find it. */
export async function migrateTaskFolders(
  worktrees: { worktreePath: string; repoPath: string }[],
  exclude: (repoPath: string) => Promise<void>,
): Promise<number> {
  let moved = 0;
  for (const w of worktrees) {
    const from = path.join(w.worktreePath, '.miac');
    const to = path.join(w.worktreePath, '.shellie');
    if (!(await pathExists(from)) || (await pathExists(to))) continue;
    try {
      // Exclude first (idempotent): a failed exclude must never leave a moved `.shellie/` that git sees.
      await exclude(w.repoPath);
      await fs.rename(from, to);
      moved++;
    } catch {
      // A failed exclude, or a locked folder on Windows: the next start tries again.
    }
  }
  return moved;
}
