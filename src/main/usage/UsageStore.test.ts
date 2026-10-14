import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultSettings, type UsageEvent } from '../../shared/usage';
import { OFFICIAL_RATES } from '../pricing/officialRates';
import { UsageStore } from './UsageStore';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const dir = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'miac-usage-'));
  dirs.push(d);
  return d;
};
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

describe('UsageStore', () => {
  it('prices, appends to the monthly file and emits changed', async () => {
    const d = dir();
    const s = new UsageStore(d, () => OFFICIAL_RATES);
    await s.load();
    const changed: string[] = [];
    s.on('changed', (t) => changed.push(t));
    const rec = await s.add(ev());
    expect(rec?.costUsd).toBe(0.026);
    expect(readdirSync(d)).toContain('records-2026-10.jsonl');
    expect(changed).toEqual(['t1']);
  });

  it('dedupes by id, also across a reload', async () => {
    const d = dir();
    const a = new UsageStore(d, () => OFFICIAL_RATES);
    await a.load();
    await a.add(ev());
    expect(await a.add(ev())).toBeNull();
    const b = new UsageStore(d, () => OFFICIAL_RATES);
    await b.load();
    expect(await b.add(ev())).toBeNull();
    expect(b.records('t1')).toHaveLength(1);
    expect(
      readFileSync(path.join(d, 'records-2026-10.jsonl'), 'utf8')
        .trim()
        .split('\n'),
    ).toHaveLength(1);
  });

  it('keeps the rate it was priced with when rates change later', async () => {
    const d = dir();
    let rates = OFFICIAL_RATES;
    const s = new UsageStore(d, () => rates);
    await s.load();
    await s.add(ev());
    rates = OFFICIAL_RATES.map((r) =>
      r.id === 'anthropic-opus-5-5' ? { ...r, inputPerM: 100 } : r,
    );
    await s.add(ev({ id: 'r2' }));
    const [first, second] = s.records('t1');
    expect(first.rate?.inputPerM).toBe(4);
    expect(second.rate?.inputPerM).toBe(100);
  });

  it('skips damaged lines and counts them', async () => {
    const d = dir();
    const a = new UsageStore(d, () => OFFICIAL_RATES);
    await a.load();
    await a.add(ev());
    appendFileSync(path.join(d, 'records-2026-10.jsonl'), '{"id":"broken"\n');
    const b = new UsageStore(d, () => OFFICIAL_RATES);
    expect(await b.load()).toEqual({ damagedLines: 1, billableBackup: null });
    expect(b.records('t1')).toHaveLength(1);
  });

  it('summarizes per session with billable flags, EUR and unpriced counts', async () => {
    const s = new UsageStore(dir(), () => OFFICIAL_RATES);
    await s.load();
    await s.add(ev({ id: 'a', sessionId: 's1' }));
    await s.add(
      ev({
        id: 'b',
        sessionId: 's1',
        model: 'claude-sonnet-5-5',
        at: '2026-10-14T10:05:00.000Z',
      }),
    );
    await s.add(
      ev({
        id: 'c',
        sessionId: 's2',
        tool: 'copilot-cli',
        model: 'mystery',
        at: '2026-10-14T11:00:00.000Z',
      }),
    );
    await s.setBillable('t1', 's1', true);
    let u = s.summarize('t1', {
      ...defaultSettings(),
      usdToEur: 0.5,
      markupPct: 10,
    });
    expect(u.sessions.map((x) => [x.sessionId, x.requests, x.models])).toEqual([
      ['s1', 2, ['claude-opus-5-5', 'claude-sonnet-5-5']],
      ['s2', 1, ['mystery']],
    ]);
    expect(u.unpricedRequests).toBe(1);
    expect(u.byTool['claude-code'].sessions).toBe(1);
    expect(u.billable.costEur).toBeCloseTo(u.billable.costUsd * 0.5 * 1.1, 6);
    await s.setBillable('t1', 's1', false);
    u = s.summarize('t1', defaultSettings());
    expect(u.sessions.find((x) => x.sessionId === 's1')?.billable).toBe(false);
    expect(u.billable.costUsd).toBe(0);
  });

  it('lists tasks changed since a time', async () => {
    const s = new UsageStore(dir(), () => OFFICIAL_RATES);
    await s.load();
    await s.add(ev({ id: 'x', taskId: 'tA' }));
    const mark = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await s.add(ev({ id: 'y', taskId: 'tB' }));
    expect(s.changedSince(mark)).toEqual(['tB']);
  });

  it('backs up a corrupt billable.json and starts with every session billable', async () => {
    for (const garbage of ['{not json', '[1,2]']) {
      const d = dir();
      const a = new UsageStore(d, () => OFFICIAL_RATES);
      await a.load();
      await a.add(ev());
      await a.setBillable('t1', 's1', false);
      writeFileSync(path.join(d, 'billable.json'), garbage);
      const b = new UsageStore(d, () => OFFICIAL_RATES);
      const res = await b.load();
      expect(res.damagedLines).toBe(0);
      expect(res.billableBackup).not.toBeNull();
      expect(res.billableBackup).toMatch(/billable\.json\.corrupt-\d+$/);
      expect(existsSync(res.billableBackup as string)).toBe(true);
      expect(existsSync(path.join(d, 'billable.json'))).toBe(false);
      expect(b.isBillable('t1', 's1')).toBe(true);
      expect(b.summarize('t1', defaultSettings()).sessions[0].billable).toBe(
        true,
      );
    }
  });

  it('persists concurrent setBillable calls for different sessions', async () => {
    const d = dir();
    const s = new UsageStore(d, () => OFFICIAL_RATES);
    await s.load();
    await Promise.all([
      s.setBillable('t1', 's1', false),
      s.setBillable('t1', 's2', false),
    ]);
    const b = new UsageStore(d, () => OFFICIAL_RATES);
    await b.load();
    expect(b.isBillable('t1', 's1')).toBe(false);
    expect(b.isBillable('t1', 's2')).toBe(false);
  });
});
