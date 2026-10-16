import type { Task } from '../../shared/types';
import { samePath } from '../paths';
import type { Candidate } from './resolve';

export type JoinVerdict =
  | 'join'
  | 'home'
  | 'already'
  | 'other-task'
  | 'detached'
  | 'main-checkout';

/** Whether a found worktree may join `task`; `openTasks` may include `task` itself and done tasks (both ignored). */
export function joinVerdict(
  task: Task,
  openTasks: Task[],
  c: Candidate,
): JoinVerdict {
  const at = (p: string) => samePath(p, c.worktreePath);
  if (at(task.worktreePath)) return 'home';
  if (task.extraWorkspaces.some((w) => at(w.worktreePath))) return 'already';
  if (task.detachedPaths.some(at)) return 'detached';
  if (c.mainCheckout) return 'main-checkout';
  const owned = openTasks.some(
    (t) =>
      t.id !== task.id &&
      t.status !== 'done' &&
      (at(t.worktreePath) ||
        t.extraWorkspaces.some((w) => !w.dropped && at(w.worktreePath))),
  );
  return owned ? 'other-task' : 'join';
}
