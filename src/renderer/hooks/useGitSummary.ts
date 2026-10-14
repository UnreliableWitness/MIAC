import { useEffect, useState } from 'react';
import type { GitSummary } from '../../shared/types';
import { api } from '../api';

const POLL_MS = 5000;

export function useGitSummary(
  taskId: string,
  worktreeMissing: boolean,
): GitSummary | null {
  const [git, setGit] = useState<GitSummary | null>(null);

  useEffect(() => {
    let live = true;
    const refresh = () =>
      api()
        .invoke('tasks:gitSummary', taskId)
        .then((g) => {
          if (live) setGit(g);
        })
        .catch(() => {
          if (live) setGit(null);
        });
    void refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [taskId, worktreeMissing]);

  return git;
}
