import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathExists } from '../fsRetry';
import type { GitClient } from '../services/GitClient';
import { samePath } from '../paths';

export type Candidate = {
  repoPath: string;
  worktreePath: string;
  branch: string | null;
  mainCheckout: boolean;
};

/** The nearest folder at or above `p` that exists (a written file may be gone, its folder usually is not). */
async function existingDir(p: string): Promise<string | null> {
  let cur = path.resolve(p);
  for (;;) {
    try {
      if ((await fs.stat(cur)).isDirectory()) return cur;
    } catch {
      // keep walking up
    }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/** The worktree containing `p`; null when it is not in a git repo. repoPath is the main checkout. */
export async function resolveCandidate(
  git: GitClient,
  p: string,
): Promise<Candidate | null> {
  const dir = await existingDir(p);
  if (!dir) return null;
  const worktreePath = await git.toplevel(dir);
  if (!worktreePath) return null;
  try {
    const repoPath = path.dirname(await git.commonDir(dir));
    return {
      repoPath,
      worktreePath,
      branch: await git.currentBranch(dir),
      mainCheckout: samePath(worktreePath, repoPath),
    };
  } catch {
    return null;
  }
}

/** Worktrees on `branch` in each repo; repos that fail are skipped. */
export async function scanBranch(
  git: GitClient,
  repoPaths: string[],
  branch: string,
): Promise<Candidate[]> {
  const found: Candidate[] = [];
  for (const repoPath of repoPaths) {
    try {
      for (const wt of await git.worktreeList(repoPath))
        if (wt.branch === branch)
          found.push({
            repoPath,
            worktreePath: wt.path,
            branch,
            mainCheckout: samePath(wt.path, repoPath),
          });
    } catch {
      // missing or broken repo: skipped
    }
  }
  return found;
}

const realReaddir = async (dir: string): Promise<string[]> =>
  (await fs.readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

const realIsRepo = (dir: string): Promise<boolean> =>
  pathExists(path.join(dir, '.git'));

/** Direct sibling folders of the given repos that contain `.git`, excluding the repos themselves and `*.worktrees` folders. */
export async function siblingRepos(
  repoPaths: string[],
  readdir: (dir: string) => Promise<string[]> = realReaddir,
  isRepo: (dir: string) => Promise<boolean> = realIsRepo,
): Promise<string[]> {
  const out: string[] = [];
  const parents = [
    ...new Set(repoPaths.map((r) => path.dirname(path.resolve(r)))),
  ];
  for (const parent of parents) {
    let names: string[];
    try {
      names = await readdir(parent);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.endsWith('.worktrees')) continue;
      const dir = path.join(parent, name);
      if (repoPaths.some((r) => samePath(r, dir))) continue;
      if (out.some((o) => samePath(o, dir))) continue;
      if (await isRepo(dir)) out.push(dir);
    }
  }
  return out;
}
