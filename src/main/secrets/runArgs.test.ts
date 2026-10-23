import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  argsRefusal,
  packageScripts,
  packageScriptName,
  withScriptSeparator,
} from './runArgs';

describe('argsRefusal', () => {
  it('lets arguments through for a plain command line', () => {
    for (const cmd of [
      'npm run a',
      'npm run a -- --x',
      'echo "a;b"',
      "echo 'x # y'",
      'npm ci\nnpm run a',
    ]) {
      expect(argsRefusal('a', cmd, ['--x'], 'darwin')).toBeNull();
      expect(argsRefusal('a', cmd, ['--x'], 'win32')).toBeNull();
    }
  });
  it('refuses arguments when the last line ends in an operator or has a comment', () => {
    const message =
      'a takes no extra arguments in Shellie: its command line ends in an operator or comment';
    for (const cmd of [
      'npm run a;',
      'npm run a # x',
      'npm run a &&',
      'npm run a ||',
      'npm run a &',
      'npm run a |',
      'npm run a \\',
      'run (',
      'run {',
      'npm run a;  \n',
      'npm ci\nnpm run a #',
      'npm run a >',
      'npm run a 2>',
      'npm run a <',
      // Any # outside quotes, to be safe.
      'echo a#b',
    ])
      for (const platform of ['darwin', 'win32'] as const)
        expect(argsRefusal('a', cmd, ['x'], platform)).toBe(message);
  });
  it('never refuses a command without arguments', () => {
    expect(argsRefusal('a', 'npm run a;', [], 'darwin')).toBeNull();
    expect(argsRefusal('a', 'npm run a', ['a&b'], 'darwin')).toBeNull();
  });
  it('refuses cmd.exe metacharacters and line breaks in arguments on Windows', () => {
    const message =
      'On Windows an argument for shellie run cannot hold & | < > ^ % ! " or a line break';
    for (const arg of [
      'a&b',
      'a|b',
      '<x',
      'x>',
      'a^b',
      '%SECRET%',
      '!X!',
      '"q',
      'a\rb',
      'a\nb',
    ])
      expect(argsRefusal('a', 'npm run a', [arg], 'win32')).toBe(message);
    expect(
      argsRefusal('a', 'npm run a', ['--grep', 'a b', "it's", 'x=1'], 'win32'),
    ).toBeNull();
  });
});

describe('withScriptSeparator', () => {
  it('puts -- before the arguments of an npm, pnpm or yarn script', () => {
    for (const cmd of [
      'npm test',
      'npm t',
      'npm run dev',
      'npm run-script dev',
      'pnpm run dev',
      'yarn run dev',
    ])
      expect(withScriptSeparator(cmd, ['--watch'])).toEqual(['--', '--watch']);
  });
  it('leaves other commands, an existing -- and no arguments alone', () => {
    expect(withScriptSeparator('dotnet test', ['--x'])).toEqual(['--x']);
    expect(withScriptSeparator('npm ci', ['--x'])).toEqual(['--x']);
    expect(withScriptSeparator('npm test', ['--', '--x'])).toEqual([
      '--',
      '--x',
    ]);
    expect(withScriptSeparator('npm run a -- --y', ['--x'])).toEqual(['--x']);
    expect(withScriptSeparator('npm test', [])).toEqual([]);
    expect(withScriptSeparator(null, ['--x'])).toEqual(['--x']);
  });
});

describe('packageScriptName', () => {
  it('names the package.json script a command runs', () => {
    expect(packageScriptName('npm test')).toBe('test');
    expect(packageScriptName('npm run lint --silent')).toBe('lint');
    expect(packageScriptName('pnpm run dev')).toBe('dev');
    expect(packageScriptName('dotnet test')).toBeNull();
    expect(packageScriptName('npm test; rm -rf x')).toBeNull();
  });
});

describe('packageScripts', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });
  it("reads the worktree's script with the pre and post scripts that run around it", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shellie-script-'));
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({
        scripts: {
          pretest: 'node leak.js',
          test: 'vitest run',
          posttest: 'echo done',
          lint: 'eslint .',
          prebuild: 'x',
        },
      }),
    );
    expect(await packageScripts(dir, 'npm test')).toEqual([
      { name: 'pretest', text: 'node leak.js' },
      { name: 'test', text: 'vitest run' },
      { name: 'posttest', text: 'echo done' },
    ]);
    expect(await packageScripts(dir, 'npm run lint')).toEqual([
      { name: 'lint', text: 'eslint .' },
    ]);
    // npm stops at a missing script: its pre script never runs.
    expect(await packageScripts(dir, 'npm run build')).toBeNull();
    expect(await packageScripts(dir, 'dotnet test')).toBeNull();
    expect(await packageScripts(path.join(dir, 'nope'), 'npm test')).toBeNull();
  });
});
