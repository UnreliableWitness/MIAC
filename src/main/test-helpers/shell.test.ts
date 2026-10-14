import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { which } from '../platform/which';
import { windowsPlatform } from '../platform/windows';
import {
  echoCmd,
  envRef,
  failCmd,
  isWindows,
  normaliseEol,
  sleepCmd,
  testPlatform,
  writeLineCmd,
} from './shell';

function run(cmd: string, env: Record<string, string> = {}, cwd?: string) {
  const { command, args } = testPlatform().shellCommand(cmd);
  return spawnSync(command, args, {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, ...env },
  });
}

describe('shell test helpers', () => {
  it('echoCmd prints its text', () => {
    const r = run(echoCmd('a b'));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('a b');
  });

  it('echoCmd survives a single quote', () => {
    expect(run(echoCmd("it's")).stdout.trim()).toBe("it's");
  });

  it('failCmd exits with its code', () => {
    expect(run(failCmd(3)).status).toBe(3);
  });

  it('a missing command exits non-zero', () => {
    expect(run('miac-no-such-command-xyz').status).not.toBe(0);
  });

  it('envRef reads the environment', () => {
    const v = run(
      `${isWindows ? 'Write-Output' : 'echo'} "V=${envRef('MIAC_X')}"`,
      { MIAC_X: 'hello' },
    );
    expect(v.stdout.trim()).toBe('V=hello');
  });

  it('sleepCmd finishes', () => {
    expect(run(sleepCmd(0)).status).toBe(0);
  });

  it('writeLineCmd writes and appends', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'miac-shell-'));
    try {
      expect(run(writeLineCmd('one', 'f.txt'), {}, dir).status).toBe(0);
      expect(run(writeLineCmd('two', 'f.txt', true), {}, dir).status).toBe(0);
      expect(normaliseEol(readFileSync(path.join(dir, 'f.txt'), 'utf8'))).toBe(
        'one\ntwo\n',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The setup-command wrapper on both Windows shells. Windows PowerShell 5.1 wraps native stderr in
// error records when its output is redirected; that must not fail a command that exits 0.
describe.runIf(isWindows).each([
  ['Windows PowerShell 5.1', (n: string) => (n === 'pwsh' ? null : which(n))],
  ['PowerShell 7', (n: string) => which(n)],
])('setup commands under %s', (_name, find) => {
  const runIn = (cmd: string) => {
    const { command, args } = windowsPlatform(process.env, {
      which: find,
    }).shellCommand(cmd);
    return spawnSync(command, args, { encoding: 'utf8' });
  };

  it('uses the intended shell', () => {
    const r = runIn('$PSVersionTable.PSVersion.Major');
    expect(r.status).toBe(0);
    const major = Number(r.stdout.trim());
    if (find('pwsh') === null) expect(major).toBe(5);
    else expect(major).toBeGreaterThanOrEqual(7);
  });

  it('native stderr with exit 0 succeeds', () => {
    const r = runIn('cmd /c "echo warn 1>&2"');
    expect(r.stderr).toContain('warn');
    expect(r.status).toBe(0);
  });

  it('a native exit code is passed on', () => {
    expect(runIn('cmd /c exit 3').status).toBe(3);
  });

  it('a missing command fails', () => {
    expect(runIn('miac-no-such-command-xyz').status).not.toBe(0);
  });

  it('a throw fails with exit 1', () => {
    const r = runIn("throw 'boom'");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('boom');
  });

  it('native stdout passes through intact', () => {
    const node = `& '${process.execPath.replaceAll("'", "''")}'`;
    const r = runIn(
      `cmd /c echo native-out; ${node} -e 'process.stdout.write(String.fromCharCode(108,105,110,101,49,10,108,105,110,101,50,10))'`,
    );
    expect(r.status).toBe(0);
    expect(normaliseEol(r.stdout)).toContain('native-out\nline1\nline2\n');
  });

  it('a cmdlet error fails', () => {
    expect(runIn('Write-Error x').status).not.toBe(0);
  });

  it('a silenced cmdlet error does not fail', () => {
    expect(
      runIn('Get-Item C:\\miac-no-such -ErrorAction SilentlyContinue').status,
    ).toBe(0);
  });

  it('a trailing comment does not swallow the wrapper', () => {
    expect(runIn('cmd /c exit 4 # comment').status).toBe(4);
  });
});
