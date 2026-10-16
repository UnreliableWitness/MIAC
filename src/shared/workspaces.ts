import type { Repo, Task, Workspace } from './types';

export const HOME_ID = 'home';

export type WorkspaceView = Omit<Workspace, 'source'> & {
  source: 'home' | 'detected' | 'manual';
};

const homeView = (task: Task): WorkspaceView => ({
  id: HOME_ID,
  repoId: task.repoId,
  branch: task.branch,
  worktreePath: task.worktreePath,
  baseRef: task.baseRef,
  baseSha: task.baseSha,
  source: 'home',
  summary: task.summary,
  pullRequest: task.pullRequest,
  reopen: task.reopen,
  dropped: task.homeDropped,
});

/** The home workspace (the task's flat fields) followed by the extra ones. */
export function taskWorkspaces(task: Task): WorkspaceView[] {
  return [homeView(task), ...task.extraWorkspaces];
}

export function activeWorkspaces(task: Task): WorkspaceView[] {
  return taskWorkspaces(task).filter((w) => !w.dropped);
}

/** The home workspace unless dropped, else the first extra still in the task, else home. */
export function activeHome(task: Task): WorkspaceView {
  const all = taskWorkspaces(task);
  return all.find((w) => !w.dropped) ?? all[0];
}

/** The task is being reopened: Reopen marked at least one workspace (home or extra) to be made again. */
export function isReopening(task: Task): boolean {
  return (
    task.reopen !== null ||
    task.extraWorkspaces.some((w) => !w.dropped && w.reopen !== null)
  );
}

/** The branches Finish pushed, for the usage comment; the home branch when none was pushed (as before #48). */
export function pushedBranches(task: Task): string[] {
  const pushed = activeWorkspaces(task)
    .filter((w) => w.summary?.pushed)
    .map((w) => w.branch);
  return pushed.length > 0 ? pushed : [activeHome(task).branch];
}

export function workspaceById(
  task: Task,
  id: string | undefined,
): WorkspaceView {
  if (id === undefined) return activeHome(task);
  const found = taskWorkspaces(task).find((w) => w.id === id);
  if (!found) throw new Error(`Unknown workspace ${id}`);
  return found;
}

/** The connection of the task's work item: its own, else the home repo's. */
export function taskConnectionId(
  task: Pick<Task, 'connectionId' | 'repoId'>,
  repos: Pick<Repo, 'id' | 'connectionId'>[],
): string | null {
  return (
    task.connectionId ??
    repos.find((r) => r.id === task.repoId)?.connectionId ??
    null
  );
}
