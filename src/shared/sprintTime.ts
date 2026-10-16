import type { LocalItemTime } from './time';
import type { SprintRow } from './types';

export type SprintTimeCell = {
  spentSeconds: number | null;
  estimateHours: number | null;
  /** Where the item's own spent figure comes from; never both. */
  source: 'local' | 'ado' | null;
  /** True when a descendant's figures are included. */
  rolledUp: boolean;
};

const add = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : a + b;

/**
 * Spent and estimate per sprint row. An item's own spent is its local time, else ADO Completed Work (never both);
 * its estimate is Original Estimate, else the recorded baseline, else Remaining + Completed. Parents add their
 * descendants (found through `parentId`) to their own figures.
 */
export function sprintTime(
  rows: SprintRow[],
  local: Record<string, LocalItemTime>,
): Map<string, SprintTimeCell> {
  const cells = new Map<string, SprintTimeCell>();
  for (const { item } of rows) {
    const l = local[item.id];
    const spentSeconds = l
      ? l.spentSeconds
      : item.completedWork !== null
        ? item.completedWork * 3600
        : null;
    const estimateHours =
      item.originalEstimate ??
      l?.baselineHours ??
      (item.remainingWork !== null || item.completedWork !== null
        ? (item.remainingWork ?? 0) + (item.completedWork ?? 0)
        : null);
    cells.set(item.id, {
      spentSeconds,
      estimateHours,
      source: l ? 'local' : item.completedWork !== null ? 'ado' : null,
      rolledUp: false,
    });
  }
  // Children follow their parent, so walking backwards finishes a child before its parent.
  for (let i = rows.length - 1; i >= 0; i--) {
    const { item, parentId } = rows[i];
    const parent = parentId ? cells.get(parentId) : undefined;
    const own = cells.get(item.id)!;
    if (!parent || (own.spentSeconds === null && own.estimateHours === null))
      continue;
    parent.spentSeconds = add(parent.spentSeconds, own.spentSeconds);
    parent.estimateHours = add(parent.estimateHours, own.estimateHours);
    parent.rolledUp = true;
  }
  return cells;
}
