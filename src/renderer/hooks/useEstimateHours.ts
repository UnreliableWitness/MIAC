import type { TaskTime } from '../../shared/time';
import { useLiveWorkItem } from './useLiveWorkItem';

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
  const item = useLiveWorkItem(enabled ? connectionId : null, workItemId);
  return (
    positive(item?.originalEstimate) ??
    positive(time?.estimate?.hours) ??
    positive(
      item ? (item.remainingWork ?? 0) + (item.completedWork ?? 0) : null,
    )
  );
}
