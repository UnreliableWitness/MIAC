import { slugify } from './naming';
import type { Task, TaskWorktree, TerminalDef, WorkItemRef } from './types';

/** A task made with a task folder (one worktree per repo inside it); older tasks are their worktree. */
export const isFolderTask = (t: Pick<Task, 'folder'>): boolean =>
  typeof t.folder === 'string' && t.folder.length > 0;

/** The worktrees of any task. An older task has one, built from its own fields. */
export function worktreesOf(t: Task): TaskWorktree[] {
  if (isFolderTask(t)) return t.worktrees ?? [];
  return [
    {
      repoId: t.repoId,
      dir: '',
      path: t.worktreePath,
      branch: t.branch,
      baseRef: t.baseRef,
      baseSha: t.baseSha,
      status:
        t.status === 'setting-up' || t.status === 'setup-failed'
          ? t.status
          : 'ready',
      copy: t.setup.copy,
      commands: t.setup.commands,
      summary: t.summary,
      pullRequest: t.pullRequest,
      reopen: t.reopen,
    },
  ];
}

/** The fields an older task keeps on itself; the rest of a worktree patch has no place there. */
const OWN = ['baseSha', 'summary', 'pullRequest', 'reopen'] as const;

/** Applies a change to one worktree of a task, in place: an older task's own fields, else the entry. */
export function patchWorktree(
  t: Task,
  repoId: string,
  patch: Partial<TaskWorktree>,
): void {
  if (!isFolderTask(t)) {
    if (repoId !== t.repoId) return;
    for (const k of OWN) if (k in patch) Object.assign(t, { [k]: patch[k] });
    return;
  }
  const w = t.worktrees?.find((x) => x.repoId === repoId);
  if (w) Object.assign(w, patch);
}

/** Where a tab runs: its repo's worktree, else the task folder (an older task's worktree). */
export function terminalCwd(t: Task, def: Pick<TerminalDef, 'repoId'>): string {
  if (isFolderTask(t) && def.repoId) {
    const w = t.worktrees?.find((x) => x.repoId === def.repoId);
    if (w) return w.path;
  }
  return t.worktreePath;
}

/** The task folder's name: short, so paths stay well under Windows' limits. */
export function folderName(workItem: WorkItemRef | null, name: string): string {
  return workItem && workItem.id
    ? `${workItem.id}-${slugify(workItem.title, 20)}`
    : slugify(name, 20);
}

/** A repo's folder name inside a task folder, unique among `taken`. */
export function repoDir(repoName: string, taken: string[]): string {
  const base = slugify(repoName, 20);
  const dir = base === 'task' && !/task/i.test(repoName) ? 'repo' : base;
  if (!taken.includes(dir)) return dir;
  for (let n = 2; ; n++)
    if (!taken.includes(`${dir}-${n}`)) return `${dir}-${n}`;
}
