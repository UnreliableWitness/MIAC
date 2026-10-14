import { useEffect, useState } from 'react';
import type { TaskUsage } from '../../shared/usage';
import { api } from '../api';

/** Usage summary for one task, refetched whenever main reports a change for it (or '*' for all tasks). */
export function useTaskUsage(taskId: string | null): TaskUsage | null {
  const [usage, setUsage] = useState<TaskUsage | null>(null);
  useEffect(() => {
    setUsage(null);
    if (!taskId) return;
    let live = true;
    const load = () =>
      api()
        .invoke('usage:task', taskId)
        .then((u) => {
          if (live) setUsage(u);
        })
        .catch(() => undefined);
    void load();
    const off = api().on('usage:changed', (p) => {
      if (p.taskId === taskId || p.taskId === '*') void load();
    });
    return () => {
      live = false;
      off();
    };
  }, [taskId]);
  return usage;
}
