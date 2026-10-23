import { errorMessage } from '../../shared/errors';
import type { PendingCleanup, Task } from '../../shared/types';
import { pathExists } from '../fsRetry';
import { FOLDER_IN_USE, GitError, type GitClient } from './GitClient';

/**
 * Removing a finished task's worktree without failing Finish (#115). On Windows a process that outlives the
 * task's terminals (a dev server's child, a dotnet build server, an editor, antivirus) often still holds a
 * file in the folder, so the removal fails every time for a while and then works. Finish keeps what is left
 * on the task (`pendingCleanup`), the task is done, and WorktreeCleanup retries it in the background.
 */

export type CleanupGit = Pick<
  GitClient,
  'worktreeRemove' | 'worktreePrune' | 'deleteBranch' | 'branchExists'
>;

/** After this long the retries go on, but the user hears about it once. */
export const GIVE_UP_MS = 24 * 60 * 60 * 1000;

/** How often main retries what is left (and once shortly after launch). */
export const RETRY_EVERY_MS = 3 * 60 * 1000;

/** A short code for telemetry and the Done page: the fs code (EPERM, EBUSY...), else in-use, git or other. */
export function cleanupErrorCode(e: unknown): string {
  for (let x = e, depth = 0; x && depth < 5; depth++) {
    if (x instanceof GitError)
      return FOLDER_IN_USE.test(x.stderr) ? 'in-use' : 'git';
    const code = (x as { code?: unknown }).code;
    if (typeof code === 'string' && /^E[A-Z]+$/.test(code)) return code;
    x = (x as { cause?: unknown }).cause;
  }
  return 'other';
}

type Target = Pick<
  PendingCleanup,
  'workspaceId' | 'repoPath' | 'worktreePath' | 'branch'
>;

/**
 * Removes a worktree folder (forced), then its branch when `branch` is set. Never throws: what could not be
 * done comes back as a PendingCleanup to retry, null when everything is gone.
 */
export async function removeWorkspace(
  git: CleanupGit,
  t: Target,
  d: { exists?: (p: string) => Promise<boolean>; now: () => number },
): Promise<PendingCleanup | null> {
  const exists = d.exists ?? pathExists;
  const left = (e: unknown): PendingCleanup => ({
    ...t,
    since: new Date(d.now()).toISOString(),
    attempts: 1,
    error: errorMessage(e),
    code: cleanupErrorCode(e),
    notified: false,
  });
  if (await exists(t.worktreePath)) {
    try {
      await git.worktreeRemove(t.repoPath, t.worktreePath, true);
    } catch (e) {
      // The branch waits too: git will not delete a branch a registered worktree has checked out.
      if (await exists(t.worktreePath)) return left(e);
    }
  }
  if (t.branch === null) return null;
  try {
    // A deleted folder leaves a stale registration that blocks branch deletion.
    await git.worktreePrune(t.repoPath);
    if (await git.branchExists(t.repoPath, t.branch))
      await git.deleteBranch(t.repoPath, t.branch);
    return null;
  } catch (e) {
    return left(e);
  }
}

export type WorktreeCleanupDeps = {
  git: CleanupGit;
  tasks: () => Task[];
  /** Takes the task for the retry; false when it is busy (Finish, Reopen) so it is skipped this time. */
  claim: (taskId: string) => boolean;
  release: (taskId: string) => void;
  /** One store write on the task, then the windows hear of it. */
  mutate: (taskId: string, change: (t: Task) => void) => Promise<void>;
  notice: (message: string) => void;
  event: (
    name: string,
    props?: Record<string, string>,
    measurements?: Record<string, number>,
  ) => void;
  now?: () => number;
  exists?: (p: string) => Promise<boolean>;
};

export class WorktreeCleanup {
  private readonly now: () => number;

  constructor(private readonly d: WorktreeCleanupDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Retries every done task's leftovers, one task at a time. */
  async retryAll(): Promise<void> {
    const ids = this.d
      .tasks()
      .filter((t) => t.status === 'done' && t.pendingCleanup.length > 0)
      .map((t) => t.id);
    for (const id of ids) await this.retryTask(id).catch(() => undefined);
  }

  /** Retries one task's leftovers now. True when nothing is left. */
  async retryTask(taskId: string): Promise<boolean> {
    const task = this.d.tasks().find((t) => t.id === taskId);
    if (!task) return true;
    // A reopened task makes its worktree again at the same path: never touch it then.
    if (task.status !== 'done') return task.pendingCleanup.length === 0;
    if (task.pendingCleanup.length === 0) return true;
    if (!this.d.claim(taskId)) return false;
    try {
      const after: PendingCleanup[] = [];
      for (const p of task.pendingCleanup) {
        const left = await removeWorkspace(this.d.git, p, {
          exists: this.d.exists,
          now: this.now,
        });
        if (!left) {
          this.d.event(
            'cleanup.done',
            { code: p.code },
            {
              attempts: p.attempts + 1,
              minutes: Math.round((this.now() - Date.parse(p.since)) / 60_000),
            },
          );
          continue;
        }
        const next: PendingCleanup = {
          ...p,
          attempts: p.attempts + 1,
          error: left.error,
          code: left.code,
        };
        if (!p.notified && this.now() - Date.parse(p.since) >= GIVE_UP_MS) {
          next.notified = true;
          this.d.event(
            'cleanup.gaveUp',
            { code: next.code },
            { attempts: next.attempts },
          );
          this.d.notice(
            `Shellie has tried for a day to delete ${p.worktreePath}, left by a finished task: ${next.error}. ` +
              'A process still holds a file there: close what runs from that folder (a dev server, an editor, ' +
              'a dotnet build server: dotnet build-server shutdown), or delete the folder yourself. Shellie keeps trying.',
          );
        }
        after.push(next);
      }
      await this.d.mutate(taskId, (t) => {
        t.pendingCleanup = after;
      });
      return after.length === 0;
    } finally {
      this.d.release(taskId);
    }
  }
}
