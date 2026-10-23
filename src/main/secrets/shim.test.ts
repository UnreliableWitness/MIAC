import { execFile } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UsageReceiver, type RunRoute } from '../usage/UsageReceiver';
import {
  agentRunEnv,
  SHIM_CMD,
  SHIM_PS1,
  SHIM_SH,
  shimFiles,
  withShimPath,
  writeShims,
} from './shim';

describe('shim text', () => {
  it('sh: curl with the token from a file, no proxy, a connect timeout and no time limit', () => {
    expect(SHIM_SH.startsWith('#!/bin/sh\n')).toBe(true);
    expect(SHIM_SH).toContain('curl -q -s -N --noproxy');
    expect(SHIM_SH).toContain('--connect-timeout 5');
    expect(SHIM_SH).not.toContain('--max-time');
    // The token never goes on curl's command line (other users can list it).
    expect(SHIM_SH).toContain('-H "@$dir/auth"');
    expect(SHIM_SH).not.toMatch(/-H "Authorization/);
    // Arguments go as separate form fields, never through a shell line.
    expect(SHIM_SH).toContain('--data-urlencode "arg=$a"');
    expect(SHIM_SH).not.toContain('eval');
    expect(SHIM_SH).toContain('Shellie is not running');
    expect(SHIM_SH).toContain(
      "This task's run link expired; start the agent tab again from Shellie",
    );
  });

  it('ps1: curl.exe (curl is an alias in PowerShell), a JSON body file and the exit line', () => {
    expect(SHIM_PS1).toContain('& curl.exe @curl $env:SHELLIE_RUN_URL');
    expect(SHIM_PS1).not.toMatch(/&\s*curl\s/);
    expect(SHIM_PS1).toContain("'--connect-timeout', '5'");
    expect(SHIM_PS1).toContain("'--noproxy', '*'");
    expect(SHIM_PS1).not.toContain('--max-time');
    expect(SHIM_PS1).toContain('ConvertTo-Json');
    expect(SHIM_PS1).toContain('\'--data-binary\', "@$body"');
    expect(SHIM_PS1).toContain('"$([char]0)exit:"');
    expect(SHIM_PS1).not.toContain('Invoke-Expression');
    expect(SHIM_PS1).toContain('Shellie is not running');
    expect(SHIM_PS1).toContain(
      "This task's run link expired; start the agent tab again from Shellie",
    );
  });

  it('cmd: PowerShell runs the ps1 next to it with every argument', () => {
    expect(SHIM_CMD).toContain(
      'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0shellie.ps1" %*',
    );
    expect(SHIM_CMD).toContain('exit /b %ERRORLEVEL%');
    expect(SHIM_CMD).toContain('\r\n');
  });

  it('writes all three (Git Bash on Windows runs the sh one), the sh one executable', async () => {
    expect(shimFiles().map((f) => f.name)).toEqual([
      'shellie',
      'shellie.cmd',
      'shellie.ps1',
    ]);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'shim-'));
    try {
      await writeShims(path.join(dir, 'bin'));
      const sh = path.join(dir, 'bin', 'shellie');
      expect(readFileSync(sh, 'utf8')).toBe(SHIM_SH);
      if (process.platform !== 'win32')
        expect(statSync(sh).mode & 0o111).toBe(0o111);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('agentRunEnv', () => {
  const o = {
    url: 'http://127.0.0.1:4319/v1/run',
    token: 'tok',
    shimDir: '/data/bin',
    env: { PATH: '/usr/bin' },
    delimiter: ':',
  };
  it('gives agent tabs the run URL, their task token and the shim first on PATH', () => {
    for (const kind of ['claude', 'copilot', 'opencode'] as const)
      expect(agentRunEnv(kind, o)).toEqual({
        SHELLIE_RUN_URL: 'http://127.0.0.1:4319/v1/run',
        SHELLIE_RUN_TOKEN: 'tok',
        PATH: '/data/bin:/usr/bin',
      });
  });
  it('gives other tabs none of it', () => {
    for (const kind of ['shell', 'run'] as const)
      expect(agentRunEnv(kind, o)).toEqual({});
  });
});

describe('withShimPath', () => {
  it('prefixes the PATH key that is there (Windows: Path)', () => {
    expect(withShimPath({ Path: 'C:\\x' }, 'C:\\bin', ';')).toEqual({
      Path: 'C:\\bin;C:\\x',
    });
    expect(withShimPath({ PATH: '/usr/bin' }, '/b', ':')).toEqual({
      PATH: '/b:/usr/bin',
    });
    expect(withShimPath({}, '/b', ':')).toEqual({ PATH: '/b' });
  });
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

describe.skipIf(process.platform === 'win32')('sh shim against Shellie', () => {
  let dir: string;
  let port: number;
  let receiver: UsageReceiver;
  const calls: {
    taskId: string;
    name: string;
    args: string[];
    workspace?: string;
    terminal?: string;
  }[] = [];
  const route: RunRoute = {
    taskFor: (t) => (t === 'tok' ? 'task-1' : null),
    names: async () => ['dev', 'test'],
    start: async (taskId, name, args, out, o) => {
      calls.push({
        taskId,
        name,
        args,
        workspace: o?.workspace,
        terminal: o?.terminal,
      });
      if (name !== 'dev') {
        out(`Unknown command "${name}". Commands for shellie run: dev, test\n`);
        return 1;
      }
      out('starting\n');
      await new Promise((r) => setTimeout(r, 20));
      // Lines that look like the exit line but start with another control character are output.
      out(
        'key=[STRIPE_KEY]\nexit:9\n\u001bexit:0\n\u0001exit:5\nlast line without newline',
      );
      return 7;
    },
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'shim-run-'));
    await writeShims(dir);
    receiver = new UsageReceiver(() => undefined, undefined, undefined, route);
    port = await freePort();
    await receiver.start(port);
  });
  afterAll(async () => {
    await receiver.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const shim = (args: string[], env: Record<string, string> = {}, cwd = dir) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(
        '/bin/sh',
        [path.join(dir, 'shellie'), ...args],
        {
          cwd,
          env: {
            PATH: process.env.PATH ?? '/usr/bin:/bin',
            TMPDIR: os.tmpdir(),
            SHELLIE_RUN_URL: `http://127.0.0.1:${port}/v1/run`,
            SHELLIE_RUN_TOKEN: 'tok',
            SHELLIE_TERMINAL_ID: 'claude-1',
            ...env,
          },
        },
        (err, stdout, stderr) =>
          resolve({
            code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
            stdout,
            stderr,
          }),
      );
    });

  it('prints the output, drops the exit line and exits with its code', async () => {
    calls.length = 0;
    const r = await shim([
      'run',
      'dev',
      '--',
      'a b',
      '$(echo hi)',
      '&x=1',
      '@f',
    ]);
    expect(r.stdout).toBe(
      'starting\nkey=[STRIPE_KEY]\nexit:9\n\u001bexit:0\n\u0001exit:5\nlast line without newline\n',
    );
    expect(r.code).toBe(7);
    expect(calls).toEqual([
      {
        taskId: 'task-1',
        name: 'dev',
        args: ['a b', '$(echo hi)', '&x=1', '@f'],
        workspace: expect.any(String),
        terminal: 'claude-1',
      },
    ]);
    expect(realpathSync(calls[0]!.workspace!)).toBe(realpathSync(dir));
  });

  it('takes arguments without -- too', async () => {
    calls.length = 0;
    await shim(['run', 'dev', 'x']);
    expect(calls[0]!.args).toEqual(['x']);
  });

  it('passes a refused name on with exit 1', async () => {
    const r = await shim(['run', 'printenv']);
    expect(r.stdout).toBe(
      'Unknown command "printenv". Commands for shellie run: dev, test\n',
    );
    expect(r.code).toBe(1);
  });

  it('lists the names without one', async () => {
    const r = await shim(['run']);
    expect(r.stdout).toBe('Commands for shellie run: dev, test\n');
    expect(r.code).toBe(0);
  });

  it('says the run link expired on 401', async () => {
    const r = await shim(['run', 'dev'], { SHELLIE_RUN_TOKEN: 'old' });
    expect(r.stderr).toBe(
      "This task's run link expired; start the agent tab again from Shellie\n",
    );
    expect(r.stdout).toBe('');
    expect(r.code).toBe(1);
  });

  it('says Shellie is not running when nothing listens', async () => {
    const closed = await freePort();
    const r = await shim(['run', 'dev'], {
      SHELLIE_RUN_URL: `http://127.0.0.1:${closed}/v1/run`,
    });
    expect(r.stderr).toBe('Shellie is not running\n');
    expect(r.code).toBe(1);
  });

  it('explains itself outside an agent tab and for other commands', async () => {
    const outside = await shim(['run', 'dev'], { SHELLIE_RUN_TOKEN: '' });
    expect(outside.stderr).toBe(
      'shellie run works in an agent tab that Shellie started\n',
    );
    expect(outside.code).toBe(1);
    const other = await shim(['start', '123']);
    expect(other.stderr).toBe('Usage: shellie run <name> [-- args...]\n');
    expect(other.code).toBe(2);
  });
});
