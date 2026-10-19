import type { Rate, RateSnapshot, UsageEvent } from '../../shared/usage';

export const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export function normalizeModel(model: string): string {
  let m = model.trim().toLowerCase();
  m = m.replace(/\[[^\]]*\]$/, '');
  m = m.replace(/^(anthropic|openai|google|xai|microsoft|moonshot)[./]/, '');
  m = m.replace(/(\d)\.(\d)/g, '$1-$2').replace(/(\d)\.(\d)/g, '$1-$2');
  m = m.replace(/-\d{8}$/, '');
  m = m.replace(/[\s_]+/g, '-');
  return m;
}

/** Readable model names from a rate table: dated and undated ids share one label ("Claude Haiku 4.5"); unknown models keep their normalized id. */
export function modelLabeler(rates: Rate[]): (model: string) => string {
  const byId = new Map<string, string>();
  // Base rates (standard speed, lowest tier) first so their label wins.
  const ordered = [...rates].sort(
    (a, b) =>
      Number(a.fast) - Number(b.fast) || a.minInputTokens - b.minInputTokens,
  );
  for (const r of ordered)
    for (const m of r.match) {
      const id = normalizeModel(m);
      if (!byId.has(id)) byId.set(id, r.label.replace(/ \(fast\)$/, ''));
    }
  return (model) => {
    const id = normalizeModel(model);
    return byId.get(id) ?? id;
  };
}

export function selectRate(
  rates: Rate[],
  model: string,
  totalInputTokens: number,
  fast: boolean,
): Rate | null {
  const id = normalizeModel(model);
  const candidates = rates.filter(
    (r) =>
      r.fast === fast &&
      r.match.some((m) => normalizeModel(m) === id) &&
      r.minInputTokens <= totalInputTokens,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, r) =>
    r.minInputTokens > best.minInputTokens ? r : best,
  );
}

export function priceEvent(
  rates: Rate[],
  e: UsageEvent,
): {
  costUsd: number | null;
  rateId: string | null;
  rate: RateSnapshot | null;
} {
  const totalInput = e.inputTokens + e.cacheReadTokens + e.cacheWriteTokens;
  const rate =
    selectRate(rates, e.model, totalInput, e.fast) ??
    (e.fast ? selectRate(rates, e.model, totalInput, false) : null);
  if (!rate) return { costUsd: null, rateId: null, rate: null };
  const snap: RateSnapshot = {
    inputPerM: rate.inputPerM,
    cachedInputPerM: rate.cachedInputPerM,
    cacheWritePerM: rate.cacheWritePerM,
    outputPerM: rate.outputPerM,
  };
  const cost =
    (e.inputTokens * snap.inputPerM +
      e.cacheReadTokens * snap.cachedInputPerM +
      e.cacheWriteTokens * snap.cacheWritePerM +
      e.outputTokens * snap.outputPerM) /
    1e6;
  return { costUsd: round6(cost), rateId: rate.id, rate: snap };
}
