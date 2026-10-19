import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BudgetRecord } from '../../shared/budget';
import type { Rate } from '../../shared/usage';
import { OFFICIAL_USD_TO_EUR } from '../../shared/usage';
import { BudgetStore, isCounted, priceTokens } from './BudgetStore';

const opus: Rate = {
  id: 'anthropic-opus-5-5',
  label: 'Opus 5.5',
  match: ['claude-opus-5-5'],
  minInputTokens: 0,
  fast: false,
  inputPerM: 4,
  cachedInputPerM: 0.2,
  cacheWritePerM: 5,
  cacheWrite1hPerM: 8,
  outputPerM: 20,
} as Rate;
const rec = (o: Partial<BudgetRecord> = {}): BudgetRecord => ({
  id: 'cc:m1',
  tool: 'claude-code',
  sessionId: 's1',
  model: 'claude-opus-5-5',
  provider: 'anthropic',
  at: new Date(2026, 9, 7, 10).toISOString(),
  cwd: '/w',
  fast: false,
  inputTokens: 1_000_000,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  ...o,
});
const now = new Date(2026, 9, 19, 12);
const recent = new Date(2026, 9, 18, 10).toISOString();
const nextDay = new Date(2026, 9, 20, 12);
const base = {
  inShellie: () => false,
  now,
  monthStartDay: 1,
  sources: { claudeCode: true, openCode: true },
};
const store = async (rates: Rate[] = [opus]) => {
  const s = new BudgetStore(
    path.join(mkdtempSync(path.join(os.tmpdir(), 'bs-')), 'budget.json'),
    () => rates,
  );
  await s.load();
  return s;
};
const day = (s: BudgetStore) => s.value.days['2026-10-07'];
const recentDay = (s: BudgetStore) => s.value.days['2026-10-18'];

describe('priceTokens', () => {
  it('prices 1h writes at their own rate, in EUR', () => {
    const t = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 1e6,
      cacheWrite1hTokens: 1e6,
    };
    expect(priceTokens([opus], 'claude-opus-5-5', false, t)).toBeCloseTo(
      (5 + 8) * OFFICIAL_USD_TO_EUR,
      6,
    );
  });
  it('returns null for an unknown model', () =>
    expect(
      priceTokens([opus], 'claude-mystery-9', false, {
        inputTokens: 1,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
      }),
    ).toBeNull());
});

describe('isCounted', () => {
  it('counts Claude Code and Anthropic OpenCode, keeps Copilot Claude as not counted, drops the rest', () => {
    expect(isCounted(rec())).toBe(true);
    expect(isCounted(rec({ tool: 'opencode', provider: 'anthropic' }))).toBe(
      true,
    );
    expect(
      isCounted(
        rec({
          tool: 'opencode',
          provider: 'github-copilot',
          model: 'claude-sonnet-4.6',
        }),
      ),
    ).toBe(false);
    expect(
      isCounted(rec({ tool: 'opencode', provider: 'openai', model: 'gpt-5' })),
    ).toBeNull();
  });
});

describe('BudgetStore.apply', () => {
  it('counts a message id once, across lines and files', async () => {
    const s = await store();
    await s.apply({ ...base, records: [rec(), rec()] });
    await s.apply({ ...base, records: [rec()] });
    expect(day(s)).toHaveLength(1);
    expect(day(s)[0]).toMatchObject({
      requests: 1,
      inputTokens: 1_000_000,
      counted: true,
    });
    expect(day(s)[0].costEur).toBeCloseTo(4 * OFFICIAL_USD_TO_EUR, 6);
  });

  it('replaces an OpenCode message updated after it was counted', async () => {
    const s = await store();
    const oc = (out: number) =>
      rec({
        id: 'oc:x',
        tool: 'opencode',
        at: recent,
        inputTokens: 0,
        outputTokens: out,
      });
    await s.apply({ ...base, records: [oc(1_000_000)] });
    await s.apply({ ...base, records: [oc(2_000_000)] });
    expect(recentDay(s)[0]).toMatchObject({
      requests: 1,
      outputTokens: 2_000_000,
    });
    expect(recentDay(s)[0].costEur).toBeCloseTo(40 * OFFICIAL_USD_TO_EUR, 6);
  });

  it('keeps the largest copy of a Claude Code message and ignores smaller repeats', async () => {
    const s = await store();
    const cc = (out: number) =>
      rec({ id: 'cc:g', at: recent, inputTokens: 0, outputTokens: out });
    await s.apply({ ...base, records: [cc(10)] });
    await s.apply({ ...base, records: [cc(50)] });
    expect(recentDay(s)[0]).toMatchObject({ requests: 1, outputTokens: 50 });
    await s.apply({ ...base, records: [cc(30)] });
    expect(recentDay(s)[0]).toMatchObject({ requests: 1, outputTokens: 50 });
  });

  it('compacts entries older than 2 days to their day key and then skips repeats', async () => {
    const s = await store();
    await s.apply({
      ...base,
      records: [
        rec({ id: 'cc:r', at: recent }),
        rec({ id: 'cc:s', at: new Date(2026, 9, 17, 10).toISOString() }),
      ],
    });
    expect(typeof s.value.seen['cc:r']).toBe('object');
    expect(typeof s.value.seen['cc:s']).toBe('object');
    await s.apply({ ...base, now: new Date(2026, 9, 20, 12), records: [] });
    expect(typeof s.value.seen['cc:r']).toBe('object'); // Oct 18 is exactly 2 days before Oct 20
    expect(s.value.seen['cc:s']).toBe('2026-10-17');
    await s.apply({
      ...base,
      now: new Date(2026, 9, 20, 12),
      records: [
        rec({
          id: 'cc:s',
          at: new Date(2026, 9, 17, 10).toISOString(),
          outputTokens: 999,
        }),
      ],
    });
    expect(s.value.days['2026-10-17'][0]).toMatchObject({
      requests: 1,
      outputTokens: 0,
    });
  });

  it('keeps not-counted rows without cost and drops non-Claude models', async () => {
    const s = await store();
    await s.apply({
      ...base,
      records: [
        rec({
          id: 'oc:c',
          tool: 'opencode',
          provider: 'github-copilot',
          model: 'claude-sonnet-4.6',
        }),
        rec({
          id: 'oc:g',
          tool: 'opencode',
          provider: 'openai',
          model: 'gpt-5',
        }),
      ],
    });
    expect(day(s)).toEqual([
      expect.objectContaining({
        counted: false,
        costEur: null,
        requests: 1,
        provider: 'github-copilot',
      }),
    ]);
  });

  it('stores an unknown model unpriced and prices it once a rate exists', async () => {
    const rates: Rate[] = [];
    const s = await store(rates);
    await s.apply({
      ...base,
      records: [rec({ id: 'cc:u', model: 'claude-opus-5-5' })],
    });
    expect(day(s)[0].costEur).toBeNull();
    rates.push(opus);
    // Same day: maintenance already ran, so nothing to do.
    expect(await s.apply({ ...base, records: [] })).toBe(false);
    expect(await s.apply({ ...base, now: nextDay, records: [] })).toBe(true);
    expect(day(s)[0].costEur).toBeCloseTo(4 * OFFICIAL_USD_TO_EUR, 6);
  });

  it('splits rows by in/outside Shellie', async () => {
    const s = await store();
    await s.apply({
      ...base,
      inShellie: (r) => r.sessionId === 'in',
      records: [rec({ id: 'cc:a', sessionId: 'in' }), rec({ id: 'cc:b' })],
    });
    expect(
      day(s)
        .map((r) => r.inShellie)
        .sort(),
    ).toEqual([false, true]);
  });

  it('forgets seen ids older than the previous budget month', async () => {
    const s = await store();
    await s.apply({
      ...base,
      now: new Date(2026, 7, 10),
      records: [rec({ id: 'cc:old', at: new Date(2026, 7, 2).toISOString() })],
    });
    expect(s.value.seen['cc:old']).toBe('2026-08-02');
    await s.apply({ ...base, records: [] });
    expect(s.value.seen['cc:old']).toBeUndefined();
    expect(s.value.days['2026-08-02']).toHaveLength(1);
  });

  it('survives a reload', async () => {
    const s = await store();
    await s.apply({
      ...base,
      records: [rec()],
      claudeCursors: { '/f': { offset: 1, size: 1, mtimeMs: 1, ino: 1 } },
      openCodeCursor: 9,
    });
    const again = new BudgetStore(
      (s as unknown as { file: string }).file,
      () => [opus],
    );
    await again.load();
    expect(again.value.openCodeCursor).toBe(9);
    expect(again.value.seen['cc:m1']).toBe('2026-10-07');
  });

  it('reprices an unpriced row at the tier of the average request, not the day total', async () => {
    const rates: Rate[] = [];
    const s = await store(rates);
    const haiku = (id: string) =>
      rec({ id, model: 'claude-haiku-5-5', inputTokens: 60_000 });
    await s.apply({
      ...base,
      records: [haiku('cc:h1'), haiku('cc:h2'), haiku('cc:h3')],
    });
    const baseRate = {
      ...opus,
      id: 'h-base',
      match: ['claude-haiku-5-5'],
      inputPerM: 1,
    } as Rate;
    rates.push(baseRate, {
      ...baseRate,
      id: 'h-long',
      minInputTokens: 100_000,
      inputPerM: 5,
    } as Rate);
    await s.apply({ ...base, now: nextDay, records: [] });
    expect(day(s)[0].costEur).toBeCloseTo(3 * 0.06 * OFFICIAL_USD_TO_EUR, 6);
  });

  it('keeps a priced row priced when an unpriced contribution is replaced by a larger copy', async () => {
    const rates: Rate[] = [];
    const s = await store(rates);
    const cc = (out: number) =>
      rec({ id: 'cc:p', at: recent, inputTokens: 0, outputTokens: out });
    await s.apply({ ...base, records: [cc(1_000_000)] });
    rates.push(opus);
    await s.apply({ ...base, now: nextDay, records: [] });
    expect(recentDay(s)[0].costEur).toBeCloseTo(20 * OFFICIAL_USD_TO_EUR, 6);
    await s.apply({ ...base, records: [cc(2_000_000)] });
    expect(recentDay(s)[0]).toMatchObject({
      requests: 1,
      outputTokens: 2_000_000,
    });
    expect(recentDay(s)[0].costEur).toBeCloseTo(40 * OFFICIAL_USD_TO_EUR, 6);
  });

  it('removes rows and days emptied by a replacement that moves day', async () => {
    const s = await store();
    const at = (d: number) => new Date(2026, 9, d, 10).toISOString();
    await s.apply({
      ...base,
      records: [
        rec({ id: 'oc:mv', tool: 'opencode', at: at(18), inputTokens: 1 }),
      ],
    });
    await s.apply({
      ...base,
      records: [
        rec({ id: 'oc:mv', tool: 'opencode', at: at(19), inputTokens: 2 }),
      ],
    });
    expect(s.value.days['2026-10-18']).toBeUndefined();
    expect(s.value.days['2026-10-19']).toHaveLength(1);
  });

  it('ignores unseen records older than the previous budget month', async () => {
    const s = await store();
    expect(
      await s.apply({
        ...base,
        records: [
          rec({ id: 'cc:ancient', at: new Date(2026, 7, 2).toISOString() }),
        ],
      }),
    ).toBe(true);
    expect(s.value.days['2026-08-02']).toBeUndefined();
    expect(s.value.seen['cc:ancient']).toBeUndefined();
  });

  it('keeps the larger copy when duplicates arrive larger-then-smaller in one apply', async () => {
    const s = await store();
    const cc = (out: number) =>
      rec({ id: 'cc:w', at: recent, inputTokens: 0, outputTokens: out });
    await s.apply({ ...base, records: [cc(50), cc(10)] });
    expect(recentDay(s)[0]).toMatchObject({ requests: 1, outputTokens: 50 });
  });

  it('prices a fast record with the standard rate when no fast rate exists', async () => {
    const s = await store();
    await s.apply({ ...base, records: [rec({ id: 'cc:f', fast: true })] });
    expect(day(s)[0].costEur).toBeCloseTo(4 * OFFICIAL_USD_TO_EUR, 6);
  });

  it('does not write when nothing changed and maintenance already ran today', async () => {
    const s = await store();
    const cursors = { '/f': { offset: 1, size: 1, mtimeMs: 1, ino: 1 } };
    await s.apply({
      ...base,
      records: [rec()],
      claudeCursors: cursors,
      openCodeCursor: 9,
    });
    const file = (s as unknown as { file: string }).file;
    const before = statSync(file).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    expect(
      await s.apply({
        ...base,
        records: [],
        claudeCursors: { '/f': { ...cursors['/f'] } },
        openCodeCursor: 9,
      }),
    ).toBe(false);
    expect(statSync(file).mtimeMs).toBe(before);
    // A moved cursor is written, without counting as a change.
    expect(
      await s.apply({
        ...base,
        records: [],
        claudeCursors: cursors,
        openCodeCursor: 10,
      }),
    ).toBe(false);
    expect(statSync(file).mtimeMs).not.toBe(before);
    expect(s.value.openCodeCursor).toBe(10);
  });

  it('does not write for repeats that change nothing', async () => {
    const s = await store();
    await s.apply({ ...base, records: [rec({ at: recent })] });
    const file = (s as unknown as { file: string }).file;
    const before = statSync(file).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    expect(
      await s.apply({
        ...base,
        records: [
          rec({ at: recent }),
          rec({
            id: 'oc:g',
            tool: 'opencode',
            provider: 'openai',
            model: 'gpt-5',
          }),
          rec({ id: 'cc:old', at: new Date(2026, 6, 1).toISOString() }),
        ],
      }),
    ).toBe(false);
    expect(statSync(file).mtimeMs).toBe(before);
  });

  it('runs maintenance once per local day', async () => {
    const s = await store();
    await s.apply({ ...base, records: [] });
    expect(s.value.maintainedOn).toBe('2026-10-19');
    await s.apply({ ...base, now: nextDay, records: [] });
    expect(s.value.maintainedOn).toBe('2026-10-20');
  });

  it('marks the store scanned after the first pass, and loads older files', async () => {
    const s = await store();
    expect(s.value.scanned).toBe(false);
    expect(await s.apply({ ...base, records: [] })).toBe(true);
    expect(s.value.scanned).toBe(true);
    const file = path.join(
      mkdtempSync(path.join(os.tmpdir(), 'bs-')),
      'b.json',
    );
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        days: {},
        seen: {},
        claudeCursors: {},
        openCodeCursor: 3,
        alerts: {},
        sources: { claudeCode: true, openCode: false },
      }),
    );
    const old = new BudgetStore(file, () => [opus]);
    await old.load();
    expect(old.value).toMatchObject({
      openCodeCursor: 3,
      scanned: false,
      maintainedOn: '',
    });
  });

  it('markAlert is idempotent', async () => {
    const s = await store();
    await s.markAlert('2026-10-01', 'at80');
    await s.markAlert('2026-10-01', 'at80');
    expect(s.value.alerts['2026-10-01']).toEqual(['at80']);
  });
});
