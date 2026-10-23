import { describe, expect, it } from 'vitest';
import type { BudgetTokens } from '../../shared/budget';
import { priceTokens } from '../budget/BudgetStore';
import { OFFICIAL_RATES } from '../pricing/officialRates';
import { priceRecord } from './price';

const t = (o: Partial<BudgetTokens>): BudgetTokens => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  ...o,
});

describe('priceRecord', () => {
  it('prices like the budget', () => {
    const fixtures: [string, boolean, BudgetTokens][] = [
      // Fast mode with 5m and 1h cache writes.
      [
        'claude-opus-5-5',
        true,
        t({
          inputTokens: 1200,
          outputTokens: 3400,
          cacheReadTokens: 50_000,
          cacheWrite5mTokens: 2000,
          cacheWrite1hTokens: 8000,
        }),
      ],
      // The long-context tier.
      [
        'claude-haiku-5-5',
        false,
        t({ inputTokens: 150_000, outputTokens: 900 }),
      ],
      // Through GitHub Copilot, prefixed.
      [
        'github-copilot/gpt-5-mini',
        false,
        t({ inputTokens: 4000, outputTokens: 700, cacheReadTokens: 1000 }),
      ],
    ];
    for (const [model, fast, tokens] of fixtures) {
      const p = priceRecord(OFFICIAL_RATES, model, fast, tokens);
      expect(p).not.toBeNull();
      expect(p!.costEur).toBe(priceTokens(OFFICIAL_RATES, model, fast, tokens));
      expect(p!.rateId).toBeTruthy();
      expect(p!.costUsd).toBeGreaterThan(0);
    }
    expect(
      priceRecord(OFFICIAL_RATES, 'claude-haiku-5-5', false, fixtures[1][2])!
        .rateId,
    ).toBe('anthropic-haiku-5-5-long');
  });

  it('is null for a model without a rate', () => {
    expect(
      priceRecord(
        OFFICIAL_RATES,
        'no-such-model',
        false,
        t({ inputTokens: 1 }),
      ),
    ).toBeNull();
  });
});
