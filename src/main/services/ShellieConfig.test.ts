import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadShellieConfig, ShellieConfigError } from './ShellieConfig';

const tmpDirs: string[] = [];

const repo = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'shellie-cfg-'));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadShellieConfig', () => {
  it('returns defaults without a file and no lockfile', async () => {
    const c = await loadShellieConfig(repo());
    expect(c).toEqual({
      base: 'main',
      branch: '{type}/{id}-{slug}',
      copy: [],
      copyAgentConfig: true,
      setup: [],
      run: {},
      found: false,
    });
  });

  it('defaults setup to npm ci when package-lock.json exists', async () => {
    const r = repo();
    writeFileSync(path.join(r, 'package-lock.json'), '{}');
    expect((await loadShellieConfig(r)).setup).toEqual(['npm ci']);
  });

  it('reads the full file from the mockup', async () => {
    const r = repo();
    writeFileSync(
      path.join(r, '.shellie.yml'),
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
    expect(await loadShellieConfig(r)).toEqual({
      base: 'develop',
      branch: '{type}/{id}-{slug}',
      copy: ['.env', '.env.local'],
      copyAgentConfig: true,
      setup: ['npm ci', 'npm run build'],
      run: { dev: 'npm run dev', test: 'npm test', lint: 'npm run lint' },
      found: true,
    });
  });

  it('accepts a single string for setup and copy', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.shellie.yml'), 'setup: npm ci\ncopy: .env\n');
    const c = await loadShellieConfig(r);
    expect(c.setup).toEqual(['npm ci']);
    expect(c.copy).toEqual(['.env']);
  });

  it('turns the agent config copy off with copyAgentConfig: false', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.shellie.yml'), 'copyAgentConfig: false\n');
    expect((await loadShellieConfig(r)).copyAgentConfig).toBe(false);
  });

  it('keeps the lockfile default for setup when the file omits it', async () => {
    const r = repo();
    writeFileSync(path.join(r, 'package-lock.json'), '{}');
    writeFileSync(path.join(r, '.shellie.yml'), 'base: main\n');
    expect((await loadShellieConfig(r)).setup).toEqual(['npm ci']);
  });

  it('reads apm targets, or false to turn the apm step off', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.shellie.yml'), 'apm: [claude, cursor]\n');
    expect((await loadShellieConfig(r)).apm).toEqual(['claude', 'cursor']);
    writeFileSync(path.join(r, '.shellie.yml'), 'apm: claude\n');
    expect((await loadShellieConfig(r)).apm).toEqual(['claude']);
    writeFileSync(path.join(r, '.shellie.yml'), 'apm: false\n');
    expect((await loadShellieConfig(r)).apm).toBe(false);
    writeFileSync(path.join(r, '.shellie.yml'), 'base: main\n');
    expect((await loadShellieConfig(r)).apm).toBeUndefined();
    writeFileSync(path.join(r, '.shellie.yml'), 'apm: true\n');
    await expect(loadShellieConfig(r)).rejects.toThrow(/apm/);
  });

  it('names the bad field when run is a list', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.shellie.yml'), 'run:\n  - npm run dev\n');
    const load = loadShellieConfig(r);
    await expect(load).rejects.toThrow(ShellieConfigError);
    await expect(load).rejects.toThrow(/run/);
  });

  it('names the bad field when setup is a number', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.shellie.yml'), 'setup: 5\n');
    const load = loadShellieConfig(r);
    await expect(load).rejects.toThrow(ShellieConfigError);
    await expect(load).rejects.toThrow(/setup/);
  });

  it('names the bad field when a run value is not a string', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.shellie.yml'), 'run:\n  dev: 1\n');
    const load = loadShellieConfig(r);
    await expect(load).rejects.toThrow(ShellieConfigError);
    await expect(load).rejects.toThrow(/run\.dev/);
  });

  it('reports invalid YAML with the file path', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.shellie.yml'), 'setup: [npm ci\n');
    const load = loadShellieConfig(r);
    await expect(load).rejects.toThrow(ShellieConfigError);
    await expect(load).rejects.toThrow(/not valid YAML/);
    await expect(load).rejects.toThrow(/\.shellie\.yml/);
  });

  it('rejects a non-object document naming the root', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.shellie.yml'), '- npm ci\n');
    const load = loadShellieConfig(r);
    await expect(load).rejects.toThrow(ShellieConfigError);
    await expect(load).rejects.toThrow(/\(root\)/);
  });

  it('rejects unknown keys so typos are caught', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.shellie.yml'), 'setupp:\n  - npm ci\n');
    await expect(loadShellieConfig(r)).rejects.toThrow(/setupp/);
  });

  it('treats an empty file as defaults but found', async () => {
    const r = repo();
    writeFileSync(path.join(r, '.shellie.yml'), '');
    const c = await loadShellieConfig(r);
    expect(c.found).toBe(true);
    expect(c.base).toBe('main');
  });

  it('reads review.collapse globs', async () => {
    const r = repo();
    writeFileSync(
      path.join(r, '.shellie.yml'),
      'review:\n  collapse: [src/gen/**, "*.snap"]\n',
    );
    expect((await loadShellieConfig(r)).reviewCollapse).toEqual([
      'src/gen/**',
      '*.snap',
    ]);
  });

  it('reads .miac.yml when there is no .shellie.yml', async () => {
    const dir = repo();
    writeFileSync(path.join(dir, '.miac.yml'), 'base: develop\n');
    const c = await loadShellieConfig(dir);
    expect(c.base).toBe('develop');
    expect(c.found).toBe(true);
  });

  it('prefers .shellie.yml over .miac.yml', async () => {
    const dir = repo();
    writeFileSync(path.join(dir, '.miac.yml'), 'base: old\n');
    writeFileSync(path.join(dir, '.shellie.yml'), 'base: new\n');
    expect((await loadShellieConfig(dir)).base).toBe('new');
  });

  it('names the file it read in errors', async () => {
    const dir = repo();
    writeFileSync(path.join(dir, '.miac.yml'), 'nope: 1\n');
    await expect(loadShellieConfig(dir)).rejects.toThrow(/\.miac\.yml/);
  });
});
