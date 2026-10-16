import { cell } from '../usage/csv';

export type TimeCsvRow = {
  task: string;
  workItem: string;
  booked: number | null;
  measured: number;
  realistic: number;
  wallClock: number;
  claude: number;
  copilot: number;
  opencode: number;
};

const HEAD = [
  'task',
  'work_item',
  'booked_s',
  'measured_s',
  'realistic_s',
  'wall_clock_s',
  'claude_s',
  'copilot_s',
  'opencode_est_s',
];

/** The time of a task as CSV, seconds as whole numbers; booked is empty before a booking. */
export function timeCsv(rows: TimeCsvRow[]): string {
  const sec = (n: number) => Math.round(n);
  const lines = rows.map((r) => [
    r.task,
    r.workItem,
    r.booked === null ? null : sec(r.booked),
    sec(r.measured),
    sec(r.realistic),
    sec(r.wallClock),
    sec(r.claude),
    sec(r.copilot),
    sec(r.opencode),
  ]);
  return `${[HEAD, ...lines].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
