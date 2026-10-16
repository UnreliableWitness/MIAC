import { useCallback, useEffect, useState } from 'react';
import type { TaskTime } from '../../shared/time';
import { api } from '../api';

/**
 * Time summary for one task, refetched whenever main reports a change for it.
 * `error` is true when the last load failed; `reload` fetches again.
 */
export function useTaskTime(taskId: string | null): {
  time: TaskTime | null;
  error: boolean;
  reload: () => void;
} {
  const [time, setTime] = useState<TaskTime | null>(null);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    setTime(null);
    setError(false);
    if (!taskId) return;
    let live = true;
    const load = () =>
      api()
        .invoke('time:task', taskId)
        .then((t) => {
          if (!live) return;
          setTime(t);
          setError(false);
        })
        .catch(() => {
          if (live) setError(true);
        });
    void load();
    const off = api().on('time:changed', (p) => {
      if (p.taskId === taskId) void load();
    });
    return () => {
      live = false;
      off();
    };
  }, [taskId, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { time, error, reload };
}
