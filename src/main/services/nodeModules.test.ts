import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { lockMatches, nodeModulesMatch } from './nodeModules';

const pkg = (version: string, extra: Record<string, unknown> = {}) => ({
  version,
  resolved: `https://registry.npmjs.org/x/-/x-${version}.tgz`,
  integrity: `sha512-${version}`,
  ...extra,
});

const lock = (packages: Record<string, unknown>) => ({
  lockfileVersion: 3,
  packages: { '': { name: 'app' }, ...packages },
});

describe('lockMatches', () => {
  it('matches when every package has the same version, resolved URL and integrity', () => {
    const l = lock({ 'node_modules/a': pkg('1.0.0') });
    const hidden = lock({ 'node_modules/a': pkg('1.0.0') });
    expect(lockMatches(hidden, l)).toBe(true);
  });

  it('does not match a different version', () => {
    expect(
      lockMatches(
        lock({ 'node_modules/a': pkg('1.0.0') }),
        lock({ 'node_modules/a': pkg('1.1.0') }),
      ),
    ).toBe(false);
  });

  it('allows optional packages that were not installed, not required ones', () => {
    const l = lock({
      'node_modules/a': pkg('1.0.0'),
      'node_modules/@x/linux-x64': pkg('1.0.0', { optional: true }),
      'node_modules/@x/win32-x64': pkg('1.0.0', { devOptional: true }),
    });
    expect(lockMatches(lock({ 'node_modules/a': pkg('1.0.0') }), l)).toBe(true);
    expect(
      lockMatches(lock({}), lock({ 'node_modules/a': pkg('1.0.0') })),
    ).toBe(false);
  });

  it('does not match extra installed packages', () => {
    expect(
      lockMatches(
        lock({
          'node_modules/a': pkg('1.0.0'),
          'node_modules/b': pkg('1.0.0'),
        }),
        lock({ 'node_modules/a': pkg('1.0.0') }),
      ),
    ).toBe(false);
  });

  it('never matches workspaces or links', () => {
    const ws = lock({
      'node_modules/a': pkg('1.0.0'),
      'packages/a': { version: '1.0.0' },
    });
    expect(lockMatches(ws, ws)).toBe(false);
    const link = lock({
      'node_modules/a': { resolved: 'packages/a', link: true },
    });
    expect(lockMatches(link, link)).toBe(false);
  });

  it('does not match malformed input', () => {
    expect(lockMatches(null, lock({}))).toBe(false);
    expect(lockMatches({}, lock({}))).toBe(false);
  });
});

describe('nodeModulesMatch', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'miac-nm-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the hidden lockfile and the package lock from disk', async () => {
    const nm = path.join(dir, 'node_modules');
    mkdirSync(nm);
    const file = path.join(dir, 'package-lock.json');
    writeFileSync(
      file,
      JSON.stringify(lock({ 'node_modules/a': pkg('1.0.0') })),
    );
    expect(await nodeModulesMatch(nm, file)).toBe(false);
    writeFileSync(
      path.join(nm, '.package-lock.json'),
      JSON.stringify(lock({ 'node_modules/a': pkg('1.0.0') })),
    );
    expect(await nodeModulesMatch(nm, file)).toBe(true);
    expect(await nodeModulesMatch(nm, path.join(dir, 'missing.json'))).toBe(
      false,
    );
  });
});
