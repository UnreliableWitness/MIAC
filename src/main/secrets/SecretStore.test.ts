import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { maskValue } from '../../shared/secrets';
import { fakeCrypto } from '../test-helpers/fakeCrypto';
import { SecretStore } from './SecretStore';

async function make() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'shellie-secrets-'));
  const file = path.join(dir, 'secrets.json');
  const store = new SecretStore(file, fakeCrypto());
  await store.load();
  return { dir, file, store };
}

describe('maskValue', () => {
  it('keeps a known prefix and the last four', () => {
    expect(maskValue('sk_live_abcdefghijkl0b3d')).toBe('sk_live_••••0b3d');
    expect(maskValue('plainvalue-with-tail1234')).toBe('••••1234');
    expect(maskValue('short')).toBe('••••');
  });
});

describe('SecretStore', () => {
  it('round-trips awkward values through a reload, ciphertext on disk', async () => {
    const { file, store } = await make();
    const value = 'a=b;"c"#d\n$e';
    await store.save({
      scope: { repoId: 'r1' },
      name: 'DB',
      givenTo: ['run'],
      values: { development: { value } },
    });
    expect(readFileSync(file, 'utf8')).not.toContain('a=b');
    const again = new SecretStore(file, fakeCrypto());
    await again.load();
    expect(again.valuesFor('r1', 'development').DB.value).toBe(value);
  });

  it('lists masks only', async () => {
    const { store } = await make();
    await store.save({
      scope: 'all',
      name: 'STRIPE',
      givenTo: [],
      values: { production: { value: 'sk_live_abcdefghijkl0b3d' } },
    });
    const json = JSON.stringify(store.list());
    expect(json).toContain('sk_live_••••0b3d');
    expect(json).not.toContain('abcdefghijkl');
  });

  it('lets a repo secret beat an all secret of the same name', async () => {
    const { store } = await make();
    await store.save({
      scope: 'all',
      name: 'K',
      givenTo: ['run'],
      values: { development: { value: 'global' } },
    });
    await store.save({
      scope: { repoId: 'r1' },
      name: 'K',
      givenTo: ['shell'],
      values: { development: { value: 'local' } },
    });
    expect(store.valuesFor('r1', 'development').K).toEqual({
      value: 'local',
      givenTo: ['shell'],
    });
    expect(store.valuesFor('r2', 'development').K.value).toBe('global');
  });

  it('rejects invalid names and duplicates', async () => {
    const { store } = await make();
    await expect(
      store.save({ scope: 'all', name: '1bad', givenTo: [], values: {} }),
    ).rejects.toThrow(/name/);
    await store.save({ scope: 'all', name: 'OK', givenTo: [], values: {} });
    await expect(
      store.save({ scope: 'all', name: 'OK', givenTo: [], values: {} }),
    ).rejects.toThrow(/already/);
  });

  it('updates, keeps absent environments and deletes null ones', async () => {
    const { store } = await make();
    const v = await store.save({
      scope: 'all',
      name: 'K',
      givenTo: [],
      values: { development: { value: 'd' }, test: { value: 't' } },
    });
    const next = await store.save({
      id: v.id,
      scope: 'all',
      name: 'K',
      givenTo: [],
      values: { test: null },
    });
    expect(Object.keys(next.values)).toEqual(['development']);
    await store.delete(v.id);
    expect(store.list()).toEqual([]);
  });

  it('loads empty from a missing or old file', async () => {
    const { dir, file, store } = await make();
    expect(store.list()).toEqual([]);
    writeFileSync(file, JSON.stringify({ version: 0 }));
    const again = new SecretStore(file, fakeCrypto());
    expect((await again.load()).recovered).toBe(true);
    expect(again.list()).toEqual([]);
    expect(dir).toBeTruthy();
  });

  it('reveals the value and logs time, name and environment without it', async () => {
    const { dir, store } = await make();
    const v = await store.save({
      scope: 'all',
      name: 'TOKEN',
      givenTo: [],
      values: { uat: { value: 'super-secret-value' } },
    });
    expect(store.reveal(v.id, 'uat')).toBe('super-secret-value');
    const log = readFileSync(path.join(dir, 'secrets-reveals.log'), 'utf8');
    expect(log).toMatch(/^\d{4}-\d\d-\d\dT.* TOKEN uat\n$/);
    expect(log).not.toContain('super-secret');
  });

  it('collects every value for a repo, and limits defaults to development and test', async () => {
    const { store } = await make();
    await store.save({
      scope: { repoId: 'r1' },
      name: 'A',
      givenTo: [],
      values: { development: { value: 'x' }, production: { value: 'y' } },
    });
    await store.save({
      scope: { repoId: 'r2' },
      name: 'B',
      givenTo: [],
      values: { development: { value: 'z' } },
    });
    expect(
      store
        .allValues(['r1'])
        .map((v) => v.env)
        .sort(),
    ).toEqual(['development', 'production']);
    expect(store.repoDefault('r1')).toBe('development');
    await store.setRepoDefault('r1', 'test');
    expect(store.repoDefault('r1')).toBe('test');
    await expect(store.setRepoDefault('r1', 'production')).rejects.toThrow();
  });
});
