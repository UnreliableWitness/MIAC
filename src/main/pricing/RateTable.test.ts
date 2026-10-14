import { describe, expect, it } from 'vitest';
import type { Rate, UsageEvent } from '../../shared/usage';
import { OFFICIAL_RATES } from './officialRates';
import { normalizeModel, priceEvent, round6, selectRate } from './RateTable';

const ev = (over: Partial<UsageEvent> = {}): UsageEvent => ({
  id: 'r1',
  taskId: 't1',
  tool: 'claude-code',
  sessionId: 's1',
  model: 'claude-opus-5-5',
  at: '2026-10-14T10:00:00.000Z',
  inputTokens: 1000,
  outputTokens: 500,
  cacheReadTokens: 10000,
  cacheWriteTokens: 2000,
  fast: false,
  ...over,
});

describe('normalizeModel', () => {
  it('maps provider prefixes, dotted versions and date suffixes', () => {
    expect(normalizeModel('claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(normalizeModel('Claude-Sonnet-4.6')).toBe('claude-sonnet-4-6');
    expect(normalizeModel('anthropic.claude-haiku-4-5-20251001')).toBe(
      'claude-haiku-4-5',
    );
    expect(normalizeModel('openai/gpt-5.5')).toBe('gpt-5-5');
    expect(normalizeModel('  gpt-5.4-mini ')).toBe('gpt-5-4-mini');
  });
  it('strips a bracketed context suffix', () => {
    expect(normalizeModel('claude-opus-5-5[1m]')).toBe('claude-opus-5-5');
    expect(normalizeModel('claude-sonnet-4-5-20250929[1m]')).toBe(
      'claude-sonnet-4-5',
    );
  });
});

describe('selectRate', () => {
  it('picks the default tier below the threshold and the long-context tier above it', () => {
    expect(
      selectRate(OFFICIAL_RATES, 'claude-haiku-5-5', 99_999, false)?.inputPerM,
    ).toBe(0.1);
    expect(
      selectRate(OFFICIAL_RATES, 'claude-haiku-5-5', 100_000, false)?.inputPerM,
    ).toBe(0.5);
    expect(
      selectRate(OFFICIAL_RATES, 'gpt-5.5', 300_000, false)?.inputPerM,
    ).toBe(10);
  });
  it('uses fast rows only for fast requests', () => {
    expect(
      selectRate(OFFICIAL_RATES, 'claude-opus-5-5', 10, true)?.inputPerM,
    ).toBe(8);
    expect(
      selectRate(OFFICIAL_RATES, 'claude-opus-5-5', 10, false)?.inputPerM,
    ).toBe(4);
  });
  it('returns null for unknown models', () => {
    expect(selectRate(OFFICIAL_RATES, 'some-new-model', 10, false)).toBeNull();
  });
});

describe('priceEvent', () => {
  it('prices all four token kinds and snapshots the rate', () => {
    const p = priceEvent(OFFICIAL_RATES, ev());
    // opus 5.5: 1000*4 + 10000*0.2 + 2000*5 + 500*20 = 4000+2000+10000+10000 = 26000 per 1e6
    expect(p.costUsd).toBe(0.026);
    expect(p.rate).toMatchObject({
      inputPerM: 4,
      cachedInputPerM: 0.2,
      cacheWritePerM: 5,
      outputPerM: 20,
    });
    expect(p.rateId).toBeTruthy();
  });
  it('leaves unknown models unpriced', () => {
    expect(priceEvent(OFFICIAL_RATES, ev({ model: 'mystery-1' }))).toEqual({
      costUsd: null,
      rateId: null,
      rate: null,
    });
  });
  it('rounds to 6 decimals', () => {
    expect(round6(0.1234567)).toBe(0.123457);
  });
  it('prices a Copilot model by its normalised name', () => {
    const rates: Rate[] = [
      {
        id: 'x',
        label: 'GPT-5.5',
        match: ['gpt-5-5'],
        minInputTokens: 0,
        fast: false,
        inputPerM: 5,
        cachedInputPerM: 0.5,
        cacheWritePerM: 0,
        outputPerM: 30,
      },
    ];
    expect(
      priceEvent(
        rates,
        ev({
          tool: 'copilot-cli',
          model: 'gpt-5.5',
          inputTokens: 1_000_000,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
      ).costUsd,
    ).toBe(5);
  });
});

describe('OFFICIAL_RATES', () => {
  it('has unique ids and non-negative prices', () => {
    expect(new Set(OFFICIAL_RATES.map((r) => r.id)).size).toBe(
      OFFICIAL_RATES.length,
    );
    for (const r of OFFICIAL_RATES)
      for (const k of [
        'inputPerM',
        'cachedInputPerM',
        'cacheWritePerM',
        'outputPerM',
      ] as const)
        expect(r[k]).toBeGreaterThanOrEqual(0);
  });
});
