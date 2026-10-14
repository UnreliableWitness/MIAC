import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  echoCmd,
  failCmd,
  isWindows,
  sleepCmd,
  testPlatform,
} from '../test-helpers/shell';
import { TerminalManager } from './TerminalManager';

/** command and args that run one command line in this OS's shell. */
const sh = (cmd: string) => testPlatform().shellCommand(cmd);

const managers: TerminalManager[] = [];
const create = (o?: { killWaitMs?: number }) => {
  const m = new TerminalManager(o);
  managers.push(m);
  return m;
};

const waitFor = (m: TerminalManager, id: string) =>
  new Promise<number>((resolve) => {
    const listener = (exitedId: string, code: number) => {
      if (exitedId !== id) return;
      m.off('exit', listener);
      resolve(code);
    };
    m.on('exit', listener);
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  for (const m of managers) for (const id of m.ids()) m.kill(id);
  managers.length = 0;
});

describe('TerminalManager', () => {
  it('spawns a process, streams its output and reports exit', async () => {
    const m = create();
    const chunks: string[] = [];
    m.on('data', (_id, d) => chunks.push(d));
    const exited = waitFor(m, 't1');
    m.spawn({
      id: 't1',
      taskId: 'task',
      cwd: os.tmpdir(),
      ...sh(echoCmd('hello-miac')),
    });
    expect(await exited).toBe(0);
    expect(chunks.join('')).toContain('hello-miac');
    expect(m.buffer('t1')).toContain('hello-miac');
    expect(m.isRunning('t1')).toBe(false);
  });

  it('writes to stdin and counts running terminals per task', async () => {
    const m = create();
    const exited = waitFor(m, 't2');
    m.spawn({
      id: 't2',
      taskId: 'task',
      cwd: os.tmpdir(),
      ...sh(
        isWindows
          ? '$x = [Console]::In.ReadLine(); Write-Output "got:$x"'
          : 'read x; echo got:$x',
      ),
    });
    expect(m.runningCount('task')).toBe(1);
    // ConPTY needs a carriage return for Enter; a POSIX pty accepts a line feed.
    m.write('t2', isWindows ? 'abc\r' : 'abc\n');
    expect(await exited).toBe(0);
    expect(m.buffer('t2')).toContain('got:abc');
    expect(m.runningCount('task')).toBe(0);
  });

  it('kills everything for a task and forgets the ids', async () => {
    const m = create();
    m.spawn({
      id: 'a',
      taskId: 'x',
      cwd: os.tmpdir(),
      ...sh(sleepCmd(30)),
    });
    m.spawn({
      id: 'b',
      taskId: 'x',
      cwd: os.tmpdir(),
      ...sh(sleepCmd(30)),
    });
    m.spawn({
      id: 'c',
      taskId: 'y',
      cwd: os.tmpdir(),
      ...sh(sleepCmd(30)),
    });
    m.killAllForTask('x');
    expect(m.runningCount('x')).toBe(0);
    expect(m.runningCount('y')).toBe(1);
    expect(() => m.write('a', 'x')).toThrow(/Unknown terminal/);
    m.kill('c');
  });

  it('restarts with the same options and clears the buffer', async () => {
    const m = create();
    const first = waitFor(m, 'r');
    m.spawn({
      id: 'r',
      taskId: 'task',
      cwd: os.tmpdir(),
      ...sh(echoCmd('run')),
    });
    await first;
    const second = waitFor(m, 'r');
    m.restart('r');
    await second;
    expect(m.buffer('r').split('run').length - 1).toBe(1);
  });

  it('refuses a duplicate id', () => {
    const m = create();
    m.spawn({
      id: 'd',
      taskId: 't',
      cwd: os.tmpdir(),
      ...sh(sleepCmd(30)),
    });
    expect(() =>
      m.spawn({
        id: 'd',
        taskId: 't',
        cwd: os.tmpdir(),
        ...sh(sleepCmd(30)),
      }),
    ).toThrow(/already/);
    expect(m.ids()).toEqual(['d']);
    m.kill('d');
  });

  it('restarting a running terminal does not surface the old process exit', async () => {
    const m = create();
    m.spawn({
      id: 'live',
      taskId: 't',
      cwd: os.tmpdir(),
      ...sh(sleepCmd(30)),
    });
    await sleep(100);
    const exits: number[] = [];
    m.on('exit', (id, code) => {
      if (id === 'live') exits.push(code);
    });
    m.restart('live');
    await sleep(300);
    expect(exits).toEqual([]);
    expect(m.isRunning('live')).toBe(true);
    m.kill('live');
  });

  it('keeps an exited id known until it is killed', async () => {
    const m = create();
    const exited = waitFor(m, 'e');
    m.spawn({
      id: 'e',
      taskId: 't',
      cwd: os.tmpdir(),
      ...sh(echoCmd('bye')),
    });
    await exited;
    expect(m.ids()).toEqual(['e']);
    m.kill('e');
    expect(m.ids()).toEqual([]);
  });

  it('ignores write and resize after exit', async () => {
    const m = create();
    const exited = waitFor(m, 'w');
    m.spawn({
      id: 'w',
      taskId: 't',
      cwd: os.tmpdir(),
      ...sh(failCmd(0)),
    });
    await exited;
    expect(() => m.write('w', 'x')).not.toThrow();
    expect(() => m.resize('w', 80, 24)).not.toThrow();
  });

  it('reports a non-zero exit code', async () => {
    const m = create();
    const exited = waitFor(m, 'n');
    m.spawn({
      id: 'n',
      taskId: 't',
      cwd: os.tmpdir(),
      ...sh(failCmd(3)),
    });
    expect(await exited).toBe(3);
  });

  it('keeps the terminal and its buffer when a restart fails to spawn', async () => {
    const m = create();
    const exited = waitFor(m, 'f');
    m.spawn({
      id: 'f',
      taskId: 't',
      cwd: os.tmpdir(),
      ...sh(echoCmd('before')),
    });
    await exited;
    const entry = (
      m as unknown as { entries: Map<string, { options: { args: string[] } }> }
    ).entries.get('f');
    if (!entry) throw new Error('missing entry');
    // node-pty reports a bad cwd asynchronously (exit 1), so force a synchronous spawn error instead.
    entry.options = { ...entry.options, args: [1 as unknown as string] };
    expect(() => m.restart('f')).toThrow();
    expect(m.isRunning('f')).toBe(false);
    expect(m.buffer('f')).toContain('before');
  });

  it('kill resolves once the process has exited', async () => {
    // A long fallback, so resolving in time proves the exit was seen.
    const m = create({ killWaitMs: 60_000 });
    m.spawn({ id: 'k', taskId: 't', cwd: os.tmpdir(), ...sh(sleepCmd(30)) });
    await sleep(200);
    const pid = (
      m as unknown as { entries: Map<string, { proc: { pid: number } }> }
    ).entries.get('k')?.proc.pid;
    const started = Date.now();
    await m.kill('k');
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(m.has('k')).toBe(false);
    if (!isWindows && pid) expect(() => process.kill(pid, 0)).toThrow();
  });

  it('killAllForTask resolves once every terminal of the task has exited', async () => {
    const m = create({ killWaitMs: 60_000 });
    for (const id of ['p', 'q'])
      m.spawn({ id, taskId: 'x', cwd: os.tmpdir(), ...sh(sleepCmd(30)) });
    await sleep(200);
    await m.killAllForTask('x');
    expect(m.ids()).toEqual([]);
  });

  it('kill gives up waiting after the fallback when the process does not exit', async () => {
    const m = create({ killWaitMs: 300 });
    m.spawn({ id: 'z', taskId: 't', cwd: os.tmpdir(), ...sh(sleepCmd(30)) });
    await sleep(200);
    const entry = (
      m as unknown as { entries: Map<string, { proc: { kill(): void } }> }
    ).entries.get('z');
    if (!entry) throw new Error('missing entry');
    const realKill = entry.proc.kill.bind(entry.proc);
    entry.proc.kill = () => {};
    const started = Date.now();
    await m.kill('z');
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    realKill();
  });

  it('kill of an unknown or exited terminal resolves at once', async () => {
    const m = create({ killWaitMs: 60_000 });
    await m.kill('nope');
    const exited = waitFor(m, 'gone');
    m.spawn({ id: 'gone', taskId: 't', cwd: os.tmpdir(), ...sh(failCmd(0)) });
    await exited;
    await m.kill('gone');
    expect(m.ids()).toEqual([]);
  });
});
