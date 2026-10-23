import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  GivenTo,
  SecretsReason,
  SecretsStatus,
} from '../../shared/secrets';
import type { GitClient } from '../services/GitClient';
import { isInside } from '../paths';
import { discoverSecrets } from './discover';
import { strippableKind, stripKeys } from './inject';
import type { SecretStore } from './SecretStore';

export type StatusDeps = {
  repoId: string;
  repoPath: string;
  /** The repo's `copy:` entries (files or folders). */
  copy: string[];
  store: SecretStore;
  git: GitClient;
  userSecretsDir: (id: string) => string | null;
  /** Open (not done) tasks' worktrees of this repo. */
  worktrees: { taskId: string; worktreePath: string }[];
};

async function trackedIn(git: GitClient, root: string): Promise<Set<string>> {
  try {
    const out = await git.run(root, ['ls-files', '-z']);
    return new Set(out.split('\0').filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * The copied files under `root` that hold one of the stored keys (repo-relative, `/`). Tracked files are never
 * listed: they are a warning of their own and Shellie does not change them.
 */
async function walk(
  root: string,
  copy: string[],
  tracked: Set<string>,
  visit: (
    abs: string,
    rel: string,
    kind: 'dotenv' | 'json',
  ) => Promise<boolean>,
): Promise<string[]> {
  const hits: string[] = [];
  const one = async (target: string): Promise<void> => {
    const st = await fs.lstat(target).catch(() => null);
    if (!st) return;
    if (st.isDirectory()) {
      for (const e of await fs.readdir(target))
        if (e !== 'node_modules' && e !== '.git')
          await one(path.join(target, e));
      return;
    }
    if (!st.isFile()) return;
    const rel = path.relative(root, target).split(path.sep).join('/');
    const kind = strippableKind(rel);
    if (!kind || tracked.has(rel)) return;
    if (await visit(target, rel, kind)) hits.push(rel);
  };
  for (const entry of copy) {
    const target = path.resolve(root, entry);
    if (isInside(root, target)) await one(target);
  }
  return hits;
}

async function holding(
  root: string,
  copy: string[],
  names: string[],
  tracked: Set<string>,
): Promise<string[]> {
  return walk(root, copy, tracked, async (abs, _rel, kind) => {
    const text = await fs.readFile(abs, 'utf8').catch(() => null);
    return text !== null && stripKeys(text, kind, names) !== text;
  });
}

/** Rewrites the copied files of a worktree without the stored keys. True when a file changed. */
export async function cleanWorktree(
  worktreePath: string,
  copy: string[],
  names: string[],
  git: GitClient,
): Promise<boolean> {
  if (names.length === 0) return false;
  const tracked = await trackedIn(git, worktreePath);
  const changed = await walk(
    worktreePath,
    copy,
    tracked,
    async (abs, _r, kind) => {
      const text = await fs.readFile(abs, 'utf8');
      const stripped = stripKeys(text, kind, names);
      if (stripped === text) return false;
      await fs.writeFile(abs, stripped, 'utf8');
      return true;
    },
  );
  return changed.length > 0;
}

/** The open tasks whose worktree copy still holds a stored key. */
export async function dirtyWorktrees(
  worktrees: StatusDeps['worktrees'],
  copy: string[],
  names: string[],
  git: GitClient,
): Promise<string[]> {
  const out: string[] = [];
  for (const w of worktrees) {
    const tracked = await trackedIn(git, w.worktreePath);
    if ((await holding(w.worktreePath, copy, names, tracked)).length > 0)
      out.push(w.taskId);
  }
  return out;
}

/** The distinct names of every value stored for a repo (its own and All repositories). */
export function storedNames(store: SecretStore, repoId: string): string[] {
  return [...new Set(store.allValues([repoId]).map((v) => v.name))];
}

/**
 * Whether the repo's secrets are protected. `empty` when nothing is stored (a plain .env of non-secrets is nothing
 * to protect); `protected` only when no `copy:` file, no open task's copy and no tracked file holds a stored value.
 */
export async function computeStatus(deps: StatusDeps): Promise<SecretsStatus> {
  const stored = deps.store.allValues([deps.repoId]);
  if (stored.length === 0) return { state: 'empty', reasons: [], given: [] };
  const names = [...new Set(stored.map((v) => v.name))];
  const values = new Set(stored.map((v) => v.value));
  const reasons: SecretsReason[] = [];

  const tracked = await trackedIn(deps.git, deps.repoPath);
  const copyFiles = await holding(deps.repoPath, deps.copy, names, tracked);
  if (copyFiles.length > 0) reasons.push({ kind: 'copy', files: copyFiles });

  const found = await discoverSecrets(deps.repoPath, {
    git: deps.git,
    userSecretsDir: deps.userSecretsDir,
  }).catch(() => null);
  const committed = [
    ...new Set(
      (found?.found ?? [])
        .filter((f) => f.tracked && values.has(f.value))
        .map((f) => f.source),
    ),
  ];
  if (committed.length > 0) reasons.push({ kind: 'tracked', files: committed });

  const taskIds = await dirtyWorktrees(
    deps.worktrees,
    deps.copy,
    names,
    deps.git,
  );
  if (taskIds.length > 0) reasons.push({ kind: 'worktrees', taskIds });

  const given = [
    ...new Set(
      deps.store
        .list({ repoId: deps.repoId })
        .filter((v) => Object.keys(v.values).length > 0)
        .flatMap((v) => v.givenTo),
    ),
  ] as GivenTo[];
  return {
    state: reasons.length === 0 ? 'protected' : 'attention',
    reasons,
    given,
  };
}
