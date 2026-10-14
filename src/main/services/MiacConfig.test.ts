import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMiacConfig, MiacConfigError } from './MiacConfig';

const tmpDirs: string[] = [];

const repo = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'miac-cfg-'));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadMiacConfig', () => {
  it('returns defaults without a file and no lockfile', async () => {
    const c = await loadMiacConfig(repo());
    expect(c).toEqual({
      base: 'main',
      branch: '{type}/{id}-{slug}',
      copy: [],
      setup: [],
      run: {},
      found: false,
    });
  });

  it('defaults setup to npm ci when package-lock.json exists', async () => {
    const r = repo();
    writeFileSync(path.join(r, 'package-lock.json'), '{}');
    expect((await loadMiacConfig(r)).setup).toEqual(['npm ci']);
  });

  it('reads the full file from the mockup', async () => {
    const r = repo();
    writeFileSync(
      path.join(r, '.miac.yml'),
      [
        'base: develop',
        'branch: "{type}/{id}-{slug}"',
        'copy: [.env, .env.local]',
        'setup:',
        '  - npm ci',
        '  - npm run build',
        'run:',
        '  dev: npm run dev',
        '  test: npm test',
        '  lint: npm run lint',
        '',
      ].join('\n'),
    );
    expect(await loadMiacConfig(r)).toEqual({
      base: 'develop',
      branch: '{type}/{id}-{slug}',
      copy: ['.env', '.env.local'],
      setup: ['npm ci', 'npm run build'],
      run: { dev: 'npm run dev', test: 'npm test', lint: 'npm run lint' },
      found: true,
    });
  });

  it('accepts a single string for setup and copy', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.miac.yml'), 'setup: npm ci\ncopy: .env\n');
    const c = await loadMiacConfig(r);
    expect(c.setup).toEqual(['npm ci']);
    expect(c.copy).toEqual(['.env']);
  });

  it('keeps the lockfile default for setup when the file omits it', async () => {
    const r = repo();
    writeFileSync(path.join(r, 'package-lock.json'), '{}');
    writeFileSync(path.join(r, '.miac.yml'), 'base: main\n');
    expect((await loadMiacConfig(r)).setup).toEqual(['npm ci']);
  });

  it('names the bad field when run is a list', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.miac.yml'), 'run:\n  - npm run dev\n');
    const load = loadMiacConfig(r);
    await expect(load).rejects.toThrow(MiacConfigError);
    await expect(load).rejects.toThrow(/run/);
  });

  it('names the bad field when setup is a number', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.miac.yml'), 'setup: 5\n');
    const load = loadMiacConfig(r);
    await expect(load).rejects.toThrow(MiacConfigError);
    await expect(load).rejects.toThrow(/setup/);
  });

  it('names the bad field when a run value is not a string', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.miac.yml'), 'run:\n  dev: 1\n');
    const load = loadMiacConfig(r);
    await expect(load).rejects.toThrow(MiacConfigError);
    await expect(load).rejects.toThrow(/run\.dev/);
  });

  it('reports invalid YAML with the file path', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.miac.yml'), 'setup: [npm ci\n');
    const load = loadMiacConfig(r);
    await expect(load).rejects.toThrow(MiacConfigError);
    await expect(load).rejects.toThrow(/not valid YAML/);
    await expect(load).rejects.toThrow(/\.miac\.yml/);
  });

  it('rejects a non-object document naming the root', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.miac.yml'), '- npm ci\n');
    const load = loadMiacConfig(r);
    await expect(load).rejects.toThrow(MiacConfigError);
    await expect(load).rejects.toThrow(/\(root\)/);
  });

  it('rejects unknown keys so typos are caught', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.miac.yml'), 'setupp:\n  - npm ci\n');
    await expect(loadMiacConfig(r)).rejects.toThrow(/setupp/);
  });

  it('treats an empty file as defaults but found', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.miac.yml'), '');
    const c = await loadMiacConfig(r);
    expect(c.found).toBe(true);
    expect(c.base).toBe('main');
  });
});
