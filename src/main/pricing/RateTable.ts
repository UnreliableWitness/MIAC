import type { Rate, RateSnapshot, UsageEvent } from '../../shared/usage';

export const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export function normalizeModel(model: string): string {
  let m = model.trim().toLowerCase();
  m = m.replace(/^(anthropic|openai|google|xai|microsoft|moonshot)[./]/, '');
  m = m.replace(/(\d)\.(\d)/g, '$1-$2').replace(/(\d)\.(\d)/g, '$1-$2');
  m = m.replace(/-\d{8}$/, '');
  m = m.replace(/[\s_]+/g, '-');
  return m;
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
