import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OFFICIAL_RATES } from '../pricing/officialRates';
import { RateStore } from './RateStore';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const file = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'miac-rates-'));
  dirs.push(d);
  return path.join(d, 'rates.json');
};

describe('RateStore', () => {
  it('seeds with official rates, saves edits and resets', async () => {
    const f = file();
    const s = new RateStore(f);
    await s.load();
    expect(s.list()).toEqual(OFFICIAL_RATES);
    const edited = s
      .list()
      .map((r) =>
        r.id === 'anthropic-opus-5-5' ? { ...r, inputPerM: 3.5 } : r,
      );
    await s.save(edited);
    const again = new RateStore(f);
    await again.load();
    expect(
      again.list().find((r) => r.id === 'anthropic-opus-5-5')?.inputPerM,
    ).toBe(3.5);
    await again.reset();
    expect(again.list()).toEqual(OFFICIAL_RATES);
  });
  it('rejects duplicate ids', async () => {
    const s = new RateStore(file());
    await s.load();
    await expect(
      s.save([...OFFICIAL_RATES, OFFICIAL_RATES[0]]),
    ).rejects.toThrow(/duplicate/i);
  });
});
