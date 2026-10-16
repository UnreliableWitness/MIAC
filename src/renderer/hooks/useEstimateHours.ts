import { useEffect, useState } from 'react';
import type { TaskTime } from '../../shared/time';
import type { SprintItem } from '../../shared/types';
import { api } from '../api';

const positive = (n: number | null | undefined) => (n && n > 0 ? n : null);

/**
 * The estimate in hours: the live Original Estimate, else the recorded baseline, else the live
 * Remaining + Completed. Null when none is above 0. `enabled` false skips the work item fetch.
 */
export function useEstimateHours(
  connectionId: string | null,
  workItemId: string | null,
  time: TaskTime | null,
  enabled = true,
): number | null {
  const [item, setItem] = useState<SprintItem | null>(null);
  useEffect(() => {
    setItem(null);
    if (!enabled || !connectionId || !workItemId) return;
    let live = true;
    api()
      .invoke('workItems:get', connectionId, workItemId)
      .then((w) => {
        if (live) setItem(w);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [enabled, connectionId, workItemId]);
  return (
    positive(item?.originalEstimate) ??
    positive(time?.estimate?.hours) ??
    positive(
      item ? (item.remainingWork ?? 0) + (item.completedWork ?? 0) : null,
    )
  );
}
