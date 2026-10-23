import { useCallback, useEffect, useState } from 'react';
import { activeWorkspaces } from '../../../shared/workspaces';
import type { TaskView } from '../../../shared/types';
import { api, tryInvoke } from '../../api';
import { useStore } from '../../store';

/**
 * In the task bar, only while this task's copied env files still hold keys Shellie now stores: rewrites them
 * without the keys and starts the task's secret tabs again. Nothing otherwise.
 */
export function CleanWorktreeButton({ task }: { task: TaskView }) {
  const notify = useStore((s) => s.notify);
  const [repoIds, setRepoIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const wanted = [...new Set(activeWorkspaces(task).map((w) => w.repoId))];
  const wantedKey = wanted.join(',');

  const check = useCallback(async () => {
    const dirty: string[] = [];
    for (const repoId of wantedKey.split(',').filter(Boolean)) {
      try {
        const st = await api().invoke('secrets:status', repoId);
        if (
          st.reasons.some(
            (r) => r.kind === 'worktrees' && r.taskIds.includes(task.id),
          )
        )
          dirty.push(repoId);
      } catch {
        // No status, no button.
      }
    }
    return dirty;
  }, [wantedKey, task.id]);

  useEffect(() => {
    let live = true;
    const run = () => void check().then((d) => live && setRepoIds(d));
    run();
    const off = api().on('secrets:changed', run);
    return () => {
      live = false;
      off();
    };
  }, [check]);

  if (repoIds.length === 0) return null;
  const clean = async () => {
    setBusy(true);
    // Main sends secrets.worktreesCleaned.
    for (const repoId of repoIds)
      await tryInvoke(
        () => api().invoke('secrets:cleanWorktrees', repoId, task.id),
        notify,
      );
    setBusy(false);
  };
  return (
    <button
      type="button"
      className="btn btn-sm"
      disabled={busy}
      title="Remove the stored keys from this worktree's copied env files and restart the tabs that use them"
      onClick={() => void clean()}
    >
      Clean worktree
    </button>
  );
}
