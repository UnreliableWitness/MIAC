import { promises as fs } from 'node:fs';
import path from 'node:path';

const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

/** Worktrees made before the rename keep their task file in `.miac/`; move it to `.shellie/` so the Docs tab and Claude's prompt find it. */
export async function migrateTaskFolders(
  worktrees: { worktreePath: string; repoPath: string }[],
  exclude: (repoPath: string) => Promise<void>,
): Promise<number> {
  let moved = 0;
  for (const w of worktrees) {
    const from = path.join(w.worktreePath, '.miac');
    const to = path.join(w.worktreePath, '.shellie');
    if (!(await exists(from)) || (await exists(to))) continue;
    try {
      await fs.rename(from, to);
      await exclude(w.repoPath);
      moved++;
    } catch {
      // A locked folder on Windows: the next start tries again.
    }
  }
  return moved;
}
