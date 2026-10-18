import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MARKER, SENTINEL, migrateDataFolder } from './dataFolder';

let root: string;
let from: string;
let to: string;

const write = async (base: string, rel: string, text = rel) => {
  await fs.mkdir(path.dirname(path.join(base, rel)), { recursive: true });
  await fs.writeFile(path.join(base, rel), text);
};
const exists = (p: string) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'shellie-mig-'));
  from = path.join(root, 'miac');
  to = path.join(root, 'Shellie');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const KEEP = [
  'settings.json',
  'state.json',
  'connections.json',
  'home.json',
  'telemetry-id',
  'usage/a/b.json',
  'review/t.json',
  'Local Storage/leveldb/000003.log',
];
const SKIP = [
  'Cache/x',
  'Code Cache/x',
  'GPUCache/x',
  'blob_storage/x',
  'Cookies',
  'Cookies-journal',
  'Session Storage/x',
  'DawnWebGPUCache/x',
  'GraphiteDawnCache/x',
  'DIPS',
  'Trust Tokens',
  'Shared Dictionary/x',
  'Network Persistent State',
  'Preferences',
  'DevToolsActivePort',
  'declarative_performance_observer.db',
];

describe('migrateDataFolder', () => {
  it('copies the app files and skips Chromium entries', async () => {
    for (const f of [...KEEP, ...SKIP]) await write(from, f);
    const r = await migrateDataFolder({ from, to, platform: 'darwin' });
    expect(r?.connections).toBe(true);
    for (const f of KEEP)
      expect(await fs.readFile(path.join(to, f), 'utf8')).toBe(f);
    for (const f of SKIP)
      expect(await exists(path.join(to, f.split('/')[0]))).toBe(false);
    expect(r?.copied.sort()).toEqual([
      'Local Storage',
      'connections.json',
      'home.json',
      'review',
      'settings.json',
      'state.json',
      'telemetry-id',
      'usage',
    ]);
  });

  it.each(['win32', 'darwin'] as const)(
    'skips Local State on %s',
    async (platform) => {
      await write(from, 'state.json');
      await write(from, 'Local State');
      await migrateDataFolder({ from, to, platform });
      expect(await exists(path.join(to, 'Local State'))).toBe(false);
    },
  );

  it('returns null when there is nothing to do', async () => {
    expect(
      await migrateDataFolder({ from, to, platform: 'darwin' }),
    ).toBeNull();
    await write(from, 'settings.json');
    expect(
      await migrateDataFolder({ from, to, platform: 'darwin' }),
    ).toBeNull();
    expect(await exists(to)).toBe(false);
  });

  it('returns null when the target already has data', async () => {
    await write(from, 'state.json', 'old');
    await write(to, 'connections.json', 'new');
    expect(
      await migrateDataFolder({ from, to, platform: 'darwin' }),
    ).toBeNull();
    expect(await fs.readFile(path.join(to, 'connections.json'), 'utf8')).toBe(
      'new',
    );
    expect(await exists(path.join(to, 'state.json'))).toBe(false);
  });

  it('writes the marker and a second run returns null', async () => {
    await write(from, 'state.json');
    const r = await migrateDataFolder({ from, to, platform: 'darwin' });
    const marker = JSON.parse(await fs.readFile(path.join(to, MARKER), 'utf8'));
    expect(marker.copied).toEqual(r?.copied);
    expect(
      await migrateDataFolder({ from, to, platform: 'darwin' }),
    ).toBeNull();
  });

  it('recovers from an interrupted copy and leaves no .migrating files', async () => {
    await write(from, 'state.json');
    await write(from, 'connections.json');
    await write(from, 'usage/u.json');
    let fail = true;
    const copy = async (s: string, d: string) => {
      if (fail && s.endsWith('connections.json')) throw new Error('boom');
      await fs.cp(s, d, { recursive: true });
    };
    await expect(
      migrateDataFolder({ from, to, platform: 'darwin', copy }),
    ).rejects.toThrow('boom');
    expect(await exists(path.join(to, 'state.json'))).toBe(false);
    expect(await exists(path.join(to, MARKER))).toBe(false);
    // a stale temp file from the interrupted run
    await write(to, 'state.json.migrating', 'stale');
    fail = false;
    const r = await migrateDataFolder({ from, to, platform: 'darwin', copy });
    expect(r?.copied).toContain('state.json');
    expect(await fs.readFile(path.join(to, 'state.json'), 'utf8')).toBe(
      'state.json',
    );
    expect(await exists(path.join(to, 'usage/u.json'))).toBe(true);
    expect(
      (await fs.readdir(to)).filter((n) => n.endsWith('.migrating')),
    ).toEqual([]);
  });

  it('a failed run is retried after boot wrote an empty state.json, replacing stale directories', async () => {
    await write(from, 'state.json', 'real');
    await write(from, 'connections.json', 'conn');
    await write(from, 'Local Storage/new.log');
    const bad = async (s: string, d: string) => {
      if (s.endsWith('connections.json')) throw new Error('boom');
      await fs.cp(s, d, { recursive: true });
    };
    await expect(
      migrateDataFolder({ from, to, platform: 'darwin', copy: bad }),
    ).rejects.toThrow('boom');
    expect(await exists(path.join(to, SENTINEL))).toBe(true);
    expect(await exists(path.join(to, MARKER))).toBe(false);
    await write(to, 'state.json', '{}');
    await write(to, 'Local Storage/stale.log');
    const r = await migrateDataFolder({ from, to, platform: 'darwin' });
    expect(r).not.toBeNull();
    expect(await fs.readFile(path.join(to, 'state.json'), 'utf8')).toBe('real');
    expect(await fs.readFile(path.join(to, 'connections.json'), 'utf8')).toBe(
      'conn',
    );
    expect(await exists(path.join(to, 'Local Storage/stale.log'))).toBe(false);
    expect(await exists(path.join(to, 'Local Storage/new.log'))).toBe(true);
    expect(await exists(path.join(to, SENTINEL))).toBe(false);
    expect(await exists(path.join(to, MARKER))).toBe(true);
  });
  it('gives up after the third failed run and writes a failed marker', async () => {
    await write(from, 'state.json');
    await write(from, 'connections.json');
    await write(from, 'usage/u.json');
    const bad = async (s: string, d: string) => {
      if (s.endsWith('connections.json')) throw new Error('boom');
      await fs.cp(s, d, { recursive: true });
    };
    for (let i = 1; i <= 2; i++) {
      await expect(
        migrateDataFolder({ from, to, platform: 'darwin', copy: bad }),
      ).rejects.toThrow('boom');
      expect(
        JSON.parse(await fs.readFile(path.join(to, SENTINEL), 'utf8')),
      ).toEqual({ attempts: i });
    }
    const r = await migrateDataFolder({
      from,
      to,
      platform: 'darwin',
      copy: bad,
    });
    expect(r?.failed).toBe(true);
    expect(await exists(path.join(to, SENTINEL))).toBe(false);
    const marker = JSON.parse(await fs.readFile(path.join(to, MARKER), 'utf8'));
    expect(marker.failed).toBe(true);
    expect(marker.attempts).toBe(3);
    expect(marker.copied).toContain('usage');
    expect(typeof marker.at).toBe('string');
    expect(
      await migrateDataFolder({ from, to, platform: 'darwin' }),
    ).toBeNull();
  });

  it('counts an unreadable sentinel as no attempts', async () => {
    await write(from, 'state.json');
    await write(to, SENTINEL, '2026-10-18T00:00:00.000Z');
    const bad = async () => {
      throw new Error('boom');
    };
    await expect(
      migrateDataFolder({ from, to, platform: 'darwin', copy: bad }),
    ).rejects.toThrow('boom');
    expect(
      JSON.parse(await fs.readFile(path.join(to, SENTINEL), 'utf8')),
    ).toEqual({ attempts: 1 });
  });

  it('skips the Local Storage LOCK file', async () => {
    await write(from, 'state.json');
    await write(from, 'Local Storage/leveldb/LOCK');
    await write(from, 'Local Storage/leveldb/000003.log');
    const r = await migrateDataFolder({ from, to, platform: 'darwin' });
    expect(r?.copied).toContain('Local Storage');
    expect(
      await exists(path.join(to, 'Local Storage/leveldb/000003.log')),
    ).toBe(true);
    expect(await exists(path.join(to, 'Local Storage/leveldb/LOCK'))).toBe(
      false,
    );
  });

  it('a failing Local Storage copy does not fail the run', async () => {
    await write(from, 'state.json');
    await write(from, 'Local Storage/leveldb/000003.log');
    const copy = async (s: string, d: string) => {
      if (path.basename(s) === 'Local Storage') throw new Error('locked');
      await fs.cp(s, d, { recursive: true });
    };
    const r = await migrateDataFolder({ from, to, platform: 'darwin', copy });
    expect(r).not.toBeNull();
    expect(r?.failed).toBeUndefined();
    expect(await fs.readFile(path.join(to, 'state.json'), 'utf8')).toBe(
      'state.json',
    );
    expect(await exists(path.join(to, MARKER))).toBe(true);
  });
});
