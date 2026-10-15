import type {
  RecentPoint,
  SessionSummary,
  TaskUsage,
  UsageTool,
} from './usage';

export type Bin = {
  start: number;
  costEur: number;
  byTool: Record<UsageTool, number>;
  dominant: UsageTool | null;
};

export function tokenMix(u: TaskUsage) {
  const mix = { cacheRead: 0, input: 0, cacheWrite: 0, output: 0 };
  for (const s of u.sessions.filter((x) => x.billable)) {
    mix.cacheRead += s.cacheReadTokens;
    mix.input += s.inputTokens;
    mix.cacheWrite += s.cacheWriteTokens;
    mix.output += s.outputTokens;
  }
  return mix;
}

export function timeline(
  recent: RecentPoint[],
  now: number,
  o = { hours: 6, binMinutes: 15 },
): Bin[] {
  const binMs = o.binMinutes * 60_000;
  const count = (o.hours * 60) / o.binMinutes;
  const from = now - o.hours * 3600_000;
  const bins: Bin[] = Array.from({ length: count }, (_, i) => ({
    start: from + i * binMs,
    costEur: 0,
    byTool: { 'claude-code': 0, 'copilot-cli': 0 },
    dominant: null,
  }));
  for (const p of recent) {
    const t = Date.parse(p.at);
    if (!(t >= from && t <= now)) continue;
    const i = Math.min(count - 1, Math.floor((t - from) / binMs));
    bins[i].costEur += p.costEur;
    bins[i].byTool[p.tool] += p.costEur;
  }
  for (const b of bins) {
    if (b.costEur > 0)
      b.dominant =
        b.byTool['claude-code'] >= b.byTool['copilot-cli']
          ? 'claude-code'
          : 'copilot-cli';
  }
  return bins;
}

export const isLive = (
  s: SessionSummary,
  now: number,
  windowMs = 5 * 60_000,
): boolean => now - Date.parse(s.lastAt) <= windowMs;
