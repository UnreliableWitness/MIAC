import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../../shared/usage';
import { SettingsStore } from './SettingsStore';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const file = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'shellie-set-'));
  dirs.push(d);
  return path.join(d, 'settings.json');
};

describe('SettingsStore', () => {
  it('defaults showSplash to true for files written before sub-project 6', async () => {
    const f = file();
    writeFileSync(
      f,
      JSON.stringify({ version: 1, receiverPort: 4319, hourlySync: true }),
    );
    const s = new SettingsStore(f);
    await s.load();
    expect(s.get().showSplash).toBe(true);
  });

  it('defaults, saves and reloads', async () => {
    const f = file();
    const a = new SettingsStore(f);
    await a.load();
    expect(a.get()).toEqual(defaultSettings());
    await a.save({
      ...defaultSettings(),
      hourlySync: false,
      receiverPort: 5000,
    });
    const b = new SettingsStore(f);
    await b.load();
    expect(b.get()).toMatchObject({ hourlySync: false, receiverPort: 5000 });
  });
  it('loads a settings file from sub-project 3 and drops the old keys on save', async () => {
    const f = file();
    writeFileSync(
      f,
      JSON.stringify({
        version: 1,
        receiverPort: 5000,
        usdToEur: 0.95,
        markupPct: 15,
        hourlySync: false,
      }),
    );
    const s = new SettingsStore(f);
    expect(await s.load()).toEqual({ recovered: false });
    expect(s.get()).toEqual({
      version: 1,
      receiverPort: 5000,
      hourlySync: false,
      writeCostToAdo: false,
      writeTimeToAdo: false,
      idleMinutes: 5,
      workHours: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
      showSplash: true,
      notifyOnDone: true,
      sendTelemetry: true,
      editor: { default: null, repos: {} },
    });
    await s.save({ ...s.get(), hourlySync: true });
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({
      version: 1,
      receiverPort: 5000,
      hourlySync: true,
      writeCostToAdo: false,
      writeTimeToAdo: false,
      idleMinutes: 5,
      workHours: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
      showSplash: true,
      notifyOnDone: true,
      sendTelemetry: true,
      editor: { default: null, repos: {} },
    });
  });
  it('rejects invalid values', async () => {
    const s = new SettingsStore(file());
    await s.load();
    await expect(
      s.save({ ...defaultSettings(), receiverPort: 80 }),
    ).rejects.toThrow();
    expect(s.get().receiverPort).toBe(4319);
  });
});
