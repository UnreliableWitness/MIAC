export const COMPLETED_WORK = 'Microsoft.VSTS.Scheduling.CompletedWork';
export const REMAINING_WORK = 'Microsoft.VSTS.Scheduling.RemainingWork';

/** Quarter hours, with float noise from odd current values (0.1 + 0.25) trimmed. */
const quarter = (hours: number) => Math.round(hours * 4) / 4;
const clean = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * The fields to write for booked time: the booked hours (rounded to 0.25) minus what was already written are added
 * to Completed Work and taken from Remaining Work (never below 0). Only fields the type has; null when there is
 * nothing to write.
 */
export function planTimeWrite(p: {
  bookedSeconds: number;
  writtenHours: number;
  current: { remainingWork: number | null; completedWork: number | null };
  fields: string[];
}): { patch: Record<string, number>; hours: number } | null {
  const hours = quarter(p.bookedSeconds / 3600);
  const delta = clean(hours - p.writtenHours);
  if (delta === 0) return null;
  const patch: Record<string, number> = {};
  if (p.fields.includes(COMPLETED_WORK))
    patch[COMPLETED_WORK] = clean((p.current.completedWork ?? 0) + delta);
  if (p.fields.includes(REMAINING_WORK))
    patch[REMAINING_WORK] = clean(
      Math.max(0, (p.current.remainingWork ?? 0) - delta),
    );
  return Object.keys(patch).length === 0 ? null : { patch, hours };
}

/** Which measure the booked time is closest to; custom when it is more than 5 minutes from all of them (telemetry). */
export function closestMeasure(
  booked: number,
  m: { measured: number; realistic: number; wallClock: number },
): 'measured' | 'realistic' | 'wallClock' | 'custom' {
  const entries = Object.entries(m) as [keyof typeof m, number][];
  let best: [keyof typeof m, number] | null = null;
  for (const [k, v] of entries) {
    const d = Math.abs(booked - v);
    if (d <= 300 && (!best || d < best[1])) best = [k, d];
  }
  return best ? best[0] : 'custom';
}
