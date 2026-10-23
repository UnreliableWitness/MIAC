import type { BudgetTokens } from '../../shared/budget';
import { OFFICIAL_USD_TO_EUR, type Rate } from '../../shared/usage';
import { round6, selectRate } from '../pricing/RateTable';

/** List price of one request (or a row of them): USD, EUR at the official rate, and the rate used; null without a rate. Fast mode falls back to the standard rate. The budget prices through this too, so the band and the ledger agree. */
export function priceRecord(
  rates: Rate[],
  model: string,
  fast: boolean,
  t: BudgetTokens,
  /** Input size that picks the price tier; defaults to the tokens' own input total. */
  tierInput?: number,
): { costUsd: number; costEur: number; rateId: string } | null {
  const totalIn =
    tierInput ??
    t.inputTokens +
      t.cacheReadTokens +
      t.cacheWrite5mTokens +
      t.cacheWrite1hTokens;
  const rate =
    selectRate(rates, model, totalIn, fast) ??
    (fast ? selectRate(rates, model, totalIn, false) : null);
  if (!rate) return null;
  const usd =
    (t.inputTokens * rate.inputPerM +
      t.outputTokens * rate.outputPerM +
      t.cacheReadTokens * rate.cachedInputPerM +
      t.cacheWrite5mTokens * rate.cacheWritePerM +
      t.cacheWrite1hTokens * (rate.cacheWrite1hPerM ?? rate.cacheWritePerM)) /
    1e6;
  return {
    costUsd: round6(usd),
    costEur: round6(usd * OFFICIAL_USD_TO_EUR),
    rateId: rate.id,
  };
}
