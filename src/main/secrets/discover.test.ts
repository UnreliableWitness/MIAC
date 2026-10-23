import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GitClient } from '../services/GitClient';
import { DiscoveryHold, discoverSecrets } from './discover';

const git = new GitClient();

function repo() {
  // A nested parent, so a file written next to the repo (`../outside.env`) stays in a temp folder of its own.
  const parent = mkdtempSync(path.join(os.tmpdir(), 'shellie-disc-'));
  const root = path.join(parent, 'repo');
  mkdirSync(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  const put = (rel: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  };
  const track = (...rels: string[]) => {
    execFileSync('git', ['add', ...rels], { cwd: root });
  };
  return { root, put, track };
}

const noUserSecrets = { git, userSecretsDir: () => '/nonexistent/none' };

describe('discoverSecrets', () => {
  it('finds values in known places with env, source, tracked and secretLike', async () => {
    const { root, put, track } = repo();
    put('.env', 'PORT=5173\nSTRIPE_KEY=sk_live_abcdefghijkl\n');
    put('.env.production.local', 'DB=postgres://u:p@h/d\n');
    put('.env.example', 'STRIPE_KEY=changeme\n');
    put(
      'api/appsettings.Uat.json',
      '{"ConnectionStrings":{"Db":"Server=h;Password=a=b"}}',
    );
    put(
      'api/Properties/launchSettings.json',
      '{"profiles":{"Prd":{"environmentVariables":{"Tok":"t"}}}}',
    );
    put('web/deep/er/.env', 'TOO_DEEP=1');
    put('node_modules/x/.env', 'SKIPPED=1');
    put('secrets/stripe.json', '{"webhook":"whsec_1"}');
    put('fn/local.settings.json', '{"Values":{"A":"1"}}');
    put(
      '.vscode/launch.json',
      '{"configurations":[{"name":"x","env":{"V":"1"}}]}',
    );
    put(
      'docker-compose.yml',
      'services:\n  a:\n    environment:\n      - C=1\n',
    );
    track('.env.production.local');
    const { found } = await discoverSecrets(root, noUserSecrets);
    const by = (n: string) => found.find((f) => f.name === n);
    expect(by('PORT')).toMatchObject({
      env: 'development',
      source: '.env',
      tracked: false,
      secretLike: false,
    });
    expect(by('STRIPE_KEY')).toMatchObject({
      value: 'sk_live_abcdefghijkl',
      secretLike: true,
    });
    expect(found.filter((f) => f.name === 'STRIPE_KEY')).toHaveLength(1);
    expect(by('DB')).toMatchObject({
      env: 'production',
      source: '.env.production.local',
      tracked: true,
      secretLike: true,
    });
    expect(by('ConnectionStrings__Db')).toMatchObject({
      env: 'uat',
      value: 'Server=h;Password=a=b',
    });
    expect(by('Tok')).toMatchObject({
      env: 'production',
      source: 'launch profile Prd',
    });
    expect(by('webhook')).toMatchObject({ source: 'secrets/stripe.json' });
    expect(by('A')).toMatchObject({ env: 'development' });
    expect(by('V')).toBeDefined();
    expect(by('C')).toBeDefined();
    expect(by('TOO_DEEP')).toBeUndefined();
    expect(by('SKIPPED')).toBeUndefined();
  });

  it('reads user secrets for a csproj with a UserSecretsId and nothing else outside the repo', async () => {
    const { root, put } = repo();
    const us = mkdtempSync(path.join(os.tmpdir(), 'shellie-us-'));
    mkdirSync(path.join(us, 'abc-1'));
    writeFileSync(
      path.join(us, 'abc-1', 'secrets.json'),
      '{"Stripe:Key":"sk_test_zzz"}',
    );
    put(
      'api/Api.csproj',
      '<Project><PropertyGroup><UserSecretsId>abc-1</UserSecretsId></PropertyGroup></Project>',
    );
    put('../outside.env', 'NOPE=1');
    const asked: string[] = [];
    const { found } = await discoverSecrets(root, {
      git,
      userSecretsDir: (id) => {
        asked.push(id);
        return path.join(us, id);
      },
    });
    expect(asked).toEqual(['abc-1']);
    expect(found).toContainEqual({
      name: 'Stripe__Key',
      value: 'sk_test_zzz',
      env: 'development',
      source: 'user secrets',
      tracked: false,
      secretLike: true,
    });
    expect(found.some((f) => f.name === 'NOPE')).toBe(false);
  });

  it('follows env_file inside the repo only', async () => {
    const { root, put } = repo();
    put(
      'docker-compose.yml',
      'services:\n  a:\n    env_file:\n      - ./svc.env\n      - ../outside.env\n',
    );
    put('svc.env', 'FROM_FILE=1');
    put('../outside.env', 'NOPE=1');
    const { found } = await discoverSecrets(root, noUserSecrets);
    expect(found.map((f) => f.name)).toEqual(['FROM_FILE']);
  });

  it('keeps awkward values byte for byte', async () => {
    const { root, put } = repo();
    const pem =
      '-----BEGIN PRIVATE KEY-----\nMIIE=\n$x#y z\n-----END PRIVATE KEY-----';
    put('.env', `PEM="${pem}"\nCS=Server=h;Pwd=a=b#c$d`);
    const { found } = await discoverSecrets(root, noUserSecrets);
    expect(found.find((f) => f.name === 'PEM')?.value).toBe(pem);
    expect(found.find((f) => f.name === 'CS')?.value).toBe(
      'Server=h;Pwd=a=b#c$d',
    );
  });

  it('reads only files that can hold values', async () => {
    const { root, put } = repo();
    put('.env', 'A=1');
    put('src/app.ts', 'export {}');
    put('src/deep/data.bin', 'xx');
    put('README.md', '# hi');
    put('api/Api.csproj', '<Project/>');
    put('api/appsettings.json', '{"A":{"Key":"k"}}');
    const spy = vi.spyOn(fsp, 'readFile');
    try {
      await discoverSecrets(root, noUserSecrets);
      const read = spy.mock.calls
        .map((c) => path.basename(String(c[0])))
        .sort();
      expect(read).toEqual(['.env', 'Api.csproj', 'appsettings.json']);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not follow an env_file symlink out of the repo', async () => {
    const { root, put } = repo();
    put('../outside.env', 'NOPE=1');
    symlinkSync(path.join(root, '..', 'outside.env'), path.join(root, 'link'));
    put('docker-compose.yml', 'services:\n  a:\n    env_file: ./link\n');
    put('.vscode/launch.json', '{"configurations":[{"envFile":"link"}]}');
    const { found } = await discoverSecrets(root, noUserSecrets);
    expect(found).toEqual([]);
  });

  it('skips empty values, counts unusable names, reads secrets/ folders recursively', async () => {
    const { root, put } = repo();
    put('.env', 'EMPTY=\nQ=""\nOK=1');
    put('config/my-file.secrets.json', '{"my-key":"v","good":"w"}');
    put('secrets/prod/deep/x.json', '{"tok":"t"}');
    const { found, skipped } = await discoverSecrets(root, noUserSecrets);
    expect(found.map((f) => f.name).sort()).toEqual(['OK', 'good', 'tok']);
    expect(skipped).toBe(1);
  });

  it('reads compose merge keys', async () => {
    const { root, put } = repo();
    put(
      'docker-compose.yml',
      'x-common: &c\n  environment:\n    SHARED: "1"\nservices:\n  a:\n    <<: *c\n',
    );
    const { found } = await discoverSecrets(root, noUserSecrets);
    expect(found.map((f) => f.name)).toEqual(['SHARED']);
  });

  it('works in a folder that is not a git repo', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'shellie-nogit-'));
    writeFileSync(path.join(root, '.env'), 'A=1');
    const { found } = await discoverSecrets(root, noUserSecrets);
    expect(found).toHaveLength(1);
    expect(found[0]?.tracked).toBe(false);
  });
});

describe('discoverSecrets files', () => {
  it('names the file each value came from, tracked or not, including launch profiles and user secrets', async () => {
    const { root, put, track } = repo();
    const us = mkdtempSync(path.join(os.tmpdir(), 'shellie-us-'));
    mkdirSync(path.join(us, 'abc-1'));
    writeFileSync(path.join(us, 'abc-1', 'secrets.json'), '{"K":"v1"}');
    put(
      'api/Api.csproj',
      '<Project><PropertyGroup><UserSecretsId>abc-1</UserSecretsId></PropertyGroup></Project>',
    );
    put('.env', 'A=1');
    put('.env.example', 'A=1');
    put(
      'conf/appsettings.json',
      '{"ConnectionStrings":{"Db":"Server=h;Password=p"}}',
    );
    put(
      'api/Properties/launchSettings.json',
      '{"profiles":{"Prd":{"environmentVariables":{"Tok":"t"}}}}',
    );
    put('empty/.env', '');
    track('conf/appsettings.json');
    const { files } = await discoverSecrets(root, {
      git,
      userSecretsDir: (id) => path.join(us, id),
    });
    expect(files).toEqual(
      expect.arrayContaining([
        { path: '.env', tracked: false },
        { path: 'conf/appsettings.json', tracked: true },
        { path: 'api/Properties/launchSettings.json', tracked: false },
        { path: path.join(us, 'abc-1', 'secrets.json'), tracked: false },
      ]),
    );
    expect(files.map((f) => f.path)).not.toContain('.env.example');
    expect(files.map((f) => f.path)).not.toContain('empty/.env');
  });

  it('lists a secrets folder with no tracked file in it, not one with tracked files', async () => {
    const { root, put, track } = repo();
    put('secrets/a.json', '{"x":"1"}');
    put('api/secrets/b.json', '{"x":"1"}');
    put('web/secrets/c.json', '{"x":"1"}');
    track('web/secrets/c.json');
    const { secretDirs } = await discoverSecrets(root, noUserSecrets);
    expect(secretDirs.sort()).toEqual(['api/secrets', 'secrets']);
  });
});

describe('DiscoveryHold', () => {
  it('returns masks and keys, keeps values for the import, replaces on the next discovery', () => {
    const hold = new DiscoveryHold();
    const view = hold.hold('r1', [
      {
        name: 'K',
        value: 'sk_live_abcdefghijkl0b3d',
        env: 'production',
        source: '.env',
        tracked: false,
        secretLike: true,
      },
      {
        name: 'PORT',
        value: '1',
        env: null,
        source: '.env',
        tracked: false,
        secretLike: false,
      },
    ]);
    expect(view.sources).toEqual(['.env']);
    expect(JSON.stringify(view)).not.toContain('abcdefghijkl');
    expect(view.found[0]?.mask).toBe('sk_live_••••0b3d');
    expect(view.found[0]).not.toHaveProperty('value');
    const key = view.found[0]!.key;
    expect(hold.resolve('r1', key)?.value).toBe('sk_live_abcdefghijkl0b3d');
    expect(hold.resolve('r2', key)).toBeUndefined();
    expect(view.skipped).toBe(0);
    hold.hold('r1', []);
    expect(hold.resolve('r1', key)).toBeUndefined();
  });
});
