import path from 'node:path';

/** Worktrees for `/src/webshop` live in `/src/webshop.worktrees/<slug>`. */
export function worktreeRoot(repoPath: string): string {
  const clean = path.resolve(repoPath);
  return path.join(path.dirname(clean), `${path.basename(clean)}.worktrees`);
}
