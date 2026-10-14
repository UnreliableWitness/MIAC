import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ConnectionStore,
  normalizeOrganizationUrl,
  organizationSlug,
} from './ConnectionStore';
import { fakeCrypto } from '../test-helpers/fakeCrypto';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const file = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'miac-conn-'));
  dirs.push(d);
  return path.join(d, 'connections.json');
};

describe('loopback seam', () => {
  it('accepts loopback http only when allowed', () => {
    expect(() =>
      normalizeOrganizationUrl('http://127.0.0.1:5555/org'),
    ).toThrow();
    expect(
      normalizeOrganizationUrl('http://127.0.0.1:5555/org', {
        allowLoopbackHttp: true,
      }),
    ).toBe('http://127.0.0.1:5555/org');
  });
  it('a strict store rejects localhost', () => {
    const store = new ConnectionStore(file(), fakeCrypto());
    expect(() => store.normalizeUrl('http://localhost:5555/org')).toThrow();
  });
});

describe('normalizeOrganizationUrl', () => {
  it('accepts dev.azure.com org URLs with extra path or slash', () => {
    expect(
      normalizeOrganizationUrl('https://dev.azure.com/unreliablewitness/'),
    ).toBe('https://dev.azure.com/unreliablewitness');
    expect(
      normalizeOrganizationUrl(
        'https://dev.azure.com/unreliablewitness/MIAC/_workitems',
      ),
    ).toBe('https://dev.azure.com/unreliablewitness');
    expect(normalizeOrganizationUrl('  dev.azure.com/Contoso ')).toBe(
      'https://dev.azure.com/Contoso',
    );
  });
  it('accepts visualstudio.com org URLs', () => {
    expect(
      normalizeOrganizationUrl('https://contoso.visualstudio.com/Project'),
    ).toBe('https://contoso.visualstudio.com');
  });
  it('rejects other hosts and a missing org', () => {
    expect(() => normalizeOrganizationUrl('https://github.com/x')).toThrow(
      /dev\.azure\.com/,
    );
    expect(() => normalizeOrganizationUrl('https://dev.azure.com/')).toThrow(
      /organization/,
    );
  });
  it('derives the slug', () => {
    expect(organizationSlug('https://dev.azure.com/unreliablewitness')).toBe(
      'unreliablewitness',
    );
    expect(organizationSlug('https://contoso.visualstudio.com')).toBe(
      'contoso',
    );
  });
});

describe('ConnectionStore', () => {
  it('saves a connection with an encrypted token and lists it without the token', async () => {
    const f = file();
    const store = new ConnectionStore(f, fakeCrypto());
    await store.load();
    const c = await store.save({
      organizationUrl: 'https://dev.azure.com/unreliablewitness/',
      project: 'MIAC',
      pat: 'secret-pat',
    });
    expect(c).toMatchObject({
      name: 'unreliablewitness',
      organizationUrl: 'https://dev.azure.com/unreliablewitness',
      project: 'MIAC',
      user: null,
      status: 'unknown',
      checkedAt: null,
    });
    expect(store.list()).toEqual([c]);
    expect(JSON.stringify(store.list())).not.toContain('secret-pat');
    expect(readFileSync(f, 'utf8')).not.toContain('secret-pat');
    expect(await store.token(c.id)).toBe('secret-pat');
  });

  it('reloads from disk and still decrypts', async () => {
    const f = file();
    const a = new ConnectionStore(f, fakeCrypto());
    await a.load();
    const c = await a.save({
      organizationUrl: 'https://dev.azure.com/o',
      project: 'P',
      pat: 'tok',
    });
    const b = new ConnectionStore(f, fakeCrypto());
    await b.load();
    expect(b.list()).toEqual([c]);
    expect(await b.token(c.id)).toBe('tok');
  });

  it('updates an existing connection by id and resets its status', async () => {
    const store = new ConnectionStore(file(), fakeCrypto());
    await store.load();
    const c = await store.save({
      organizationUrl: 'https://dev.azure.com/o',
      project: 'P',
      pat: 'tok',
    });
    await store.setStatus(c.id, 'ok', 'Dries');
    const updated = await store.save({
      id: c.id,
      name: 'Client',
      organizationUrl: 'https://dev.azure.com/o',
      project: 'Q',
      pat: 'tok2',
    });
    expect(updated).toMatchObject({
      id: c.id,
      name: 'Client',
      project: 'Q',
      status: 'unknown',
      user: null,
    });
    expect(store.list()).toHaveLength(1);
    expect(await store.token(c.id)).toBe('tok2');
  });

  it('refuses to save when encryption is unavailable', async () => {
    const store = new ConnectionStore(file(), fakeCrypto(false));
    await store.load();
    await expect(
      store.save({
        organizationUrl: 'https://dev.azure.com/o',
        project: 'P',
        pat: 'tok',
      }),
    ).rejects.toThrow(/encryption/i);
    expect(store.list()).toEqual([]);
  });

  it('rejects an empty pat or project', async () => {
    const store = new ConnectionStore(file(), fakeCrypto());
    await store.load();
    await expect(
      store.save({
        organizationUrl: 'https://dev.azure.com/o',
        project: '',
        pat: 'tok',
      }),
    ).rejects.toThrow(/project/i);
    await expect(
      store.save({
        organizationUrl: 'https://dev.azure.com/o',
        project: 'P',
        pat: '  ',
      }),
    ).rejects.toThrow(/token/i);
  });

  it('removes and reports unknown ids', async () => {
    const store = new ConnectionStore(file(), fakeCrypto());
    await store.load();
    const c = await store.save({
      organizationUrl: 'https://dev.azure.com/o',
      project: 'P',
      pat: 'tok',
    });
    await store.remove(c.id);
    expect(store.list()).toEqual([]);
    expect(() => store.get(c.id)).toThrow(/Unknown connection/);
    await expect(store.token(c.id)).rejects.toThrow(/Unknown connection/);
  });

  it('turns a decrypt failure into a readable error', async () => {
    const f = file();
    const store = new ConnectionStore(f, fakeCrypto());
    await store.load();
    const c = await store.save({
      organizationUrl: 'https://dev.azure.com/o',
      project: 'P',
      pat: 'tok',
    });
    const broken = new ConnectionStore(f, {
      ...fakeCrypto(),
      decrypt: () => {
        throw new Error('bad key');
      },
    });
    await broken.load();
    await expect(broken.token(c.id)).rejects.toThrow(/could not be decrypted/);
  });

  it('keeps a stored record with an invalid organization URL but never serves its token', async () => {
    const f = file();
    const lax = new ConnectionStore(f, fakeCrypto(), {
      allowLoopbackHttp: true,
    });
    await lax.load();
    const c = await lax.save({
      organizationUrl: 'http://localhost:1/org',
      project: 'P',
      pat: 'tok',
    });
    await lax.setStatus(c.id, 'ok', 'Someone');
    const strict = new ConnectionStore(f, fakeCrypto());
    await strict.load();
    expect(strict.list().map((x) => [x.id, x.status])).toEqual([
      [c.id, 'unauthorized'],
    ]);
    await expect(strict.token(c.id)).rejects.toThrow(
      'This connection has an invalid organization URL; remove it and add it again',
    );
  });

  it('backs up a corrupt file and starts empty', async () => {
    const f = file();
    writeFileSync(f, '{ nope');
    const store = new ConnectionStore(f, fakeCrypto());
    const r = await store.load();
    expect(r.recovered).toBe(true);
    expect(store.list()).toEqual([]);
  });
});
