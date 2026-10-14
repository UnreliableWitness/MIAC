import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
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
