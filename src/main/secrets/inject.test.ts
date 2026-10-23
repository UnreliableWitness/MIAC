import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ShellieConfig, TerminalDef } from '../../shared/types';
import {
  DEFAULT_GIVEN_TO,
  givenToFor,
  launchProfileArgs,
  secretsEnv,
  strippableKind,
  stripKeys,
  testCommandFor,
  withLaunchProfile,
} from './inject';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'shellie-inject-'));
  dirs.push(d);
  return d;
};

const def = (over: Partial<TerminalDef>): TerminalDef => ({
  id: 't',
  kind: 'shell',
  label: 'x',
  ...over,
});

const config = (run: Record<string, string> = {}): ShellieConfig => ({
  base: 'main',
  branch: '',
  copy: [],
  setup: [],
  run,
  found: true,
});

describe('givenToFor', () => {
  it('maps tabs to who gets secrets; agents get none', () => {
    expect(
      givenToFor(def({ kind: 'run', setupCommands: ['npm ci'] }), null),
    ).toBe('setup');
    expect(
      givenToFor(def({ kind: 'run', command: 'npm test' }), 'npm test'),
    ).toBe('tests');
    expect(
      givenToFor(def({ kind: 'run', command: 'npm run dev' }), 'npm test'),
    ).toBe('run');
    expect(givenToFor(def({ kind: 'shell' }), 'npm test')).toBe('shell');
    for (const kind of ['claude', 'copilot', 'opencode'] as const)
      expect(givenToFor(def({ kind }), 'npm test')).toBeNull();
  });

  it('defaults import to Setup, Dev server and Tests', () => {
    expect(DEFAULT_GIVEN_TO).toEqual(['setup', 'run', 'tests']);
  });
});

describe('secretsEnv', () => {
  const values = {
    DB: { value: 'dev-db', givenTo: ['setup', 'run'] as const },
    SETUP_ONLY: { value: 's', givenTo: ['setup'] as const },
    MINE: { value: 'm', givenTo: ['shell'] as const },
  };
  const v = Object.fromEntries(
    Object.entries(values).map(([k, x]) => [
      k,
      { value: x.value, givenTo: [...x.givenTo] },
    ]),
  );

  it('gives only the values meant for the tab, plus the framework environment', () => {
    expect(secretsEnv(v, 'run', 'development')).toEqual({
      DB: 'dev-db',
      ASPNETCORE_ENVIRONMENT: 'Development',
      DOTNET_ENVIRONMENT: 'Development',
      NODE_ENV: 'development',
    });
    expect(secretsEnv(v, 'shell', 'development')).toMatchObject({ MINE: 'm' });
    expect(secretsEnv(v, 'shell', 'development').DB).toBeUndefined();
  });

  it('spells the environment per framework; NODE_ENV only for development and production', () => {
    expect(secretsEnv({}, 'run', 'uat')).toEqual({
      ASPNETCORE_ENVIRONMENT: 'Uat',
      DOTNET_ENVIRONMENT: 'Uat',
    });
    expect(secretsEnv({}, 'run', 'test').NODE_ENV).toBeUndefined();
    expect(secretsEnv({}, 'run', 'production')).toMatchObject({
      ASPNETCORE_ENVIRONMENT: 'Production',
      NODE_ENV: 'production',
    });
  });

  it('sets NODE_ENV for run and shell tabs only, never for Setup or Tests', () => {
    expect(secretsEnv({}, 'setup', 'production').NODE_ENV).toBeUndefined();
    expect(secretsEnv({}, 'setup', 'production').ASPNETCORE_ENVIRONMENT).toBe(
      'Production',
    );
    expect(secretsEnv({}, 'tests', 'development').NODE_ENV).toBeUndefined();
    expect(secretsEnv({}, 'tests', 'development').DOTNET_ENVIRONMENT).toBe(
      'Development',
    );
    expect(secretsEnv({}, 'run', 'development').NODE_ENV).toBe('development');
    expect(secretsEnv({}, 'shell', 'production').NODE_ENV).toBe('production');
  });

  it('gives agent tabs nothing', () => {
    expect(secretsEnv(v, null, 'development')).toEqual({});
  });

  it('passes values verbatim', () => {
    const odd = 'a=b "q" \'s\' #h\nline2 $HOME `x` %PATH%';
    expect(
      secretsEnv({ ODD: { value: odd, givenTo: ['run'] } }, 'run', 'test').ODD,
    ).toBe(odd);
  });
});

describe('testCommandFor', () => {
  it('prefers a run entry named test', async () => {
    const d = tmp();
    writeFileSync(
      path.join(d, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest' } }),
    );
    expect(await testCommandFor(d, config({ test: 'npm run test:unit' }))).toBe(
      'npm run test:unit',
    );
  });

  it('uses npm test when package.json has a test script', async () => {
    const d = tmp();
    writeFileSync(
      path.join(d, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest' } }),
    );
    expect(await testCommandFor(d, config())).toBe('npm test');
  });

  it('uses dotnet test when a test project exists', async () => {
    const d = tmp();
    mkdirSync(path.join(d, 'tests', 'Shop.Tests'), { recursive: true });
    writeFileSync(path.join(d, 'tests', 'Shop.Tests', 'Shop.Tests.csproj'), '');
    expect(await testCommandFor(d, config())).toBe('dotnet test');
    expect(await testCommandFor(tmp(), config())).toBeNull();
  });
});

describe('launchProfileArgs', () => {
  const settings = JSON.stringify({
    profiles: {
      https: {
        commandName: 'Project',
        environmentVariables: { ASPNETCORE_ENVIRONMENT: 'Development' },
      },
      IIS: {
        commandName: 'IISExpress',
        environmentVariables: { ASPNETCORE_ENVIRONMENT: 'Production' },
      },
      Prd: { commandName: 'Project', environmentVariables: {} },
    },
  });

  it('picks the profile that maps to the environment, one folder down too', () => {
    const d = tmp();
    mkdirSync(path.join(d, 'Shop.Api', 'Properties'), { recursive: true });
    writeFileSync(
      path.join(d, 'Shop.Api', 'Properties', 'launchSettings.json'),
      settings,
    );
    expect(launchProfileArgs('dotnet run', d, 'production')).toEqual([
      '--launch-profile',
      'Prd',
    ]);
    expect(launchProfileArgs('dotnet run', d, 'development')).toEqual([
      '--launch-profile',
      'https',
    ]);
    expect(launchProfileArgs('dotnet run', d, 'uat')).toEqual([]);
    expect(launchProfileArgs('npm start', d, 'production')).toEqual([]);
    expect(
      launchProfileArgs('dotnet run --launch-profile X', d, 'production'),
    ).toEqual([]);
  });

  it('puts the profile right after dotnet run, quoting names with spaces', () => {
    expect(
      withLaunchProfile('dotnet run -- --port 1', ['--launch-profile', 'Prd']),
    ).toBe('dotnet run --launch-profile Prd -- --port 1');
    expect(
      withLaunchProfile('dotnet run', ['--launch-profile', 'My Prd']),
    ).toBe('dotnet run --launch-profile "My Prd"');
    expect(withLaunchProfile('dotnet run', [])).toBe('dotnet run');
  });
});

describe('stripKeys', () => {
  it('drops stored keys from a .env line by line, keeping everything else', () => {
    const text =
      '# comment\r\nPORT=5000\r\nexport API_KEY = "x"\r\nPEM="-----BEGIN\nabc\n-----END"\nOTHER=1 # API_KEY=2\n';
    expect(stripKeys(text, 'dotenv', ['API_KEY', 'PEM'])).toBe(
      '# comment\r\nPORT=5000\r\nOTHER=1 # API_KEY=2\n',
    );
  });

  it('leaves a .env byte-identical without matching names', () => {
    const text = '\uFEFFA=1\r\n\r\n# x\nB="2"';
    expect(stripKeys(text, 'dotenv', [])).toBe(text);
    expect(stripKeys(text, 'dotenv', ['C'])).toBe(text);
  });

  it('removes stored keys from JSON, nested with __', () => {
    const text =
      '{\n    "ConnectionStrings": { "Db": "x", "Keep": "y" },\n    "Port": 1\n}\n';
    expect(
      JSON.parse(stripKeys(text, 'json', ['ConnectionStrings__Db'])),
    ).toEqual({ ConnectionStrings: { Keep: 'y' }, Port: 1 });
    expect(stripKeys(text, 'json', ['ConnectionStrings__Db'])).toMatch(
      /^\{\n {2}"ConnectionStrings"/,
    );
    expect(stripKeys(text, 'json', ['Nope'])).toBe(text);
    expect(stripKeys('not json', 'json', ['Port'])).toBe('not json');
  });

  it('reads JSON with comments', () => {
    expect(
      JSON.parse(stripKeys('{ // c\n "A": "1", "B": 2, }', 'json', ['A'])),
    ).toEqual({ B: 2 });
  });
});

describe('strippableKind', () => {
  it('knows env and JSON files by name', () => {
    expect(strippableKind('.env')).toBe('dotenv');
    expect(strippableKind('a/.env.local')).toBe('dotenv');
    expect(strippableKind('prod.env')).toBe('dotenv');
    expect(strippableKind('appsettings.Development.json')).toBe('json');
    expect(strippableKind('Api/appsettings.json')).toBe('json');
    expect(strippableKind('local.settings.json')).toBe('json');
    expect(strippableKind('db.secrets.json')).toBe('json');
    expect(strippableKind('secrets/stripe.json')).toBe('json');
    expect(strippableKind('config.json')).toBeNull();
    expect(strippableKind('package.json')).toBeNull();
    expect(strippableKind('README.md')).toBeNull();
  });
});
