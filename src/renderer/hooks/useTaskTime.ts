import { useEffect, useState } from 'react';
import type { TaskTime } from '../../shared/time';
import { api } from '../api';

/** Time summary for one task, refetched whenever main reports a change for it. */
export function useTaskTime(taskId: string | null): TaskTime | null {
  const [time, setTime] = useState<TaskTime | null>(null);
  useEffect(() => {
    setTime(null);
    if (!taskId) return;
    let live = true;
    const load = () =>
      api()
        .invoke('time:task', taskId)
        .then((t) => {
          if (live) setTime(t);
        })
        .catch(() => undefined);
    void load();
    const off = api().on('time:changed', (p) => {
      if (p.taskId === taskId) void load();
    });
    return () => {
      live = false;
      off();
    };
  }, [taskId]);
  return time;
}
