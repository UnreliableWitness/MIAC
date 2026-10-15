const EURO = String.fromCharCode(0x20ac);

export const eur = (n: number): string =>
  `${EURO}${(Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2)}`;

export const compact = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : String(n);

export function ago(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} d ago`;
}

/** A local date and time such as "15 Oct 2026, 12:01"; the UI never shows ISO strings. */
export const dateTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
};

/** A sprint's dates such as "15 Oct – 28 Oct". ADO stores them as UTC midnights, so they are read in UTC. Null when either is unset. */
export const sprintDates = (
  start: string | null,
  finish: string | null,
): string | null => {
  if (!start || !finish) return null;
  const day = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? null
      : d.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
        });
  };
  const a = day(start);
  const b = day(finish);
  return a && b ? `${a} ${String.fromCharCode(0x2013)} ${b}` : null;
};
