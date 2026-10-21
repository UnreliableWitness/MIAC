import type {
  ModelTotals,
  RecentPoint,
  SessionSummary,
  TaskUsage,
  UsageTool,
} from './usage';

export type Bin = {
  start: number;
  end: number;
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
  // Bins sit on clock quarter hours (every time zone is a whole number of quarter hours off UTC), so whole
  // hours fall on bin edges; the last bin is the current, partly elapsed one.
  const from = Math.floor(now / binMs) * binMs - (count - 1) * binMs;
  const bins: Bin[] = Array.from({ length: count }, (_, i) => ({
    start: from + i * binMs,
    end: from + (i + 1) * binMs,
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

/** Bin edges (0 = left of the first bin, bins.length = right of the last) that fall on a local whole hour. */
export function hourTicks(bins: Bin[]): { edge: number; at: number }[] {
  const edges = [...bins.map((b) => b.start), bins.at(-1)?.end ?? 0];
  return edges.flatMap((at, edge) => {
    const d = new Date(at);
    return bins.length > 0 && d.getMinutes() === 0 && d.getSeconds() === 0
      ? [{ edge, at }]
      : [];
  });
}

const titleCase = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * A short model name for charts: "Sonnet 5.5" from the label "Claude Sonnet 5.5" or from an id like
 * `claude-sonnet-5-5` that the rate table does not know; other names stay as they are.
 */
export function shortModelName(label: string): string {
  const named = /^Claude (.+)$/.exec(label);
  if (named) return named[1];
  const id = /^claude-([a-z]+)-(\d+)(?:-(\d))?(?:-\d{8})?$/.exec(label);
  if (id) return `${titleCase(id[1])} ${id[2]}${id[3] ? `.${id[3]}` : ''}`;
  return label;
}

/** The ring's legend name: the short model name, with "(Copilot)" for models used through Copilot CLI. */
export const modelLegendName = (m: ModelTotals): string =>
  m.tool === 'copilot-cli'
    ? `${shortModelName(m.label)} (Copilot)`
    : shortModelName(m.label);

/** Each model's share of the priced total, 0..1. */
export const modelShares = (models: ModelTotals[]): number[] => {
  const total = models.reduce((n, m) => n + m.costEur, 0);
  return models.map((m) => (total > 0 ? m.costEur / total : 0));
};

export const isLive = (
  s: SessionSummary,
  now: number,
  windowMs = 5 * 60_000,
): boolean => now - Date.parse(s.lastAt) <= windowMs;
