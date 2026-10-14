import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { TerminalManager } from './TerminalManager';

const waitFor = (m: TerminalManager, id: string) =>
  new Promise<number>((resolve) =>
    m.on('exit', (exitedId, code) => {
      if (exitedId === id) resolve(code);
    }),
  );

describe('TerminalManager', () => {
  it('spawns a process, streams its output and reports exit', async () => {
    const m = new TerminalManager();
    const chunks: string[] = [];
    m.on('data', (_id, d) => chunks.push(d));
    const exited = waitFor(m, 't1');
    m.spawn({
      id: 't1',
      taskId: 'task',
      cwd: os.tmpdir(),
      command: '/bin/sh',
      args: ['-c', 'echo hello-miac'],
    });
    expect(await exited).toBe(0);
    expect(chunks.join('')).toContain('hello-miac');
    expect(m.buffer('t1')).toContain('hello-miac');
    expect(m.isRunning('t1')).toBe(false);
  });

  it('writes to stdin and counts running terminals per task', async () => {
    const m = new TerminalManager();
    const exited = waitFor(m, 't2');
    m.spawn({
      id: 't2',
      taskId: 'task',
      cwd: os.tmpdir(),
      command: '/bin/sh',
      args: ['-c', 'read x; echo got:$x'],
    });
    expect(m.runningCount('task')).toBe(1);
    m.write('t2', 'abc\n');
    expect(await exited).toBe(0);
    expect(m.buffer('t2')).toContain('got:abc');
    expect(m.runningCount('task')).toBe(0);
  });

  it('kills everything for a task and forgets the ids', async () => {
    const m = new TerminalManager();
    m.spawn({
      id: 'a',
      taskId: 'x',
      cwd: os.tmpdir(),
      command: '/bin/sh',
      args: ['-c', 'sleep 30'],
    });
    m.spawn({
      id: 'b',
      taskId: 'x',
      cwd: os.tmpdir(),
      command: '/bin/sh',
      args: ['-c', 'sleep 30'],
    });
    m.spawn({
      id: 'c',
      taskId: 'y',
      cwd: os.tmpdir(),
      command: '/bin/sh',
      args: ['-c', 'sleep 30'],
    });
    m.killAllForTask('x');
    expect(m.runningCount('x')).toBe(0);
    expect(m.runningCount('y')).toBe(1);
    expect(() => m.write('a', 'x')).toThrow(/Unknown terminal/);
    m.kill('c');
  });

  it('restarts with the same options and clears the buffer', async () => {
    const m = new TerminalManager();
    const first = waitFor(m, 'r');
    m.spawn({
      id: 'r',
      taskId: 'task',
      cwd: os.tmpdir(),
      command: '/bin/sh',
      args: ['-c', 'echo run'],
    });
    await first;
    const second = waitFor(m, 'r');
    m.restart('r');
    await second;
    expect(m.buffer('r').split('run').length - 1).toBe(1);
  });

  it('refuses a duplicate id', () => {
    const m = new TerminalManager();
    m.spawn({
      id: 'd',
      taskId: 't',
      cwd: os.tmpdir(),
      command: '/bin/sh',
      args: ['-c', 'sleep 30'],
    });
    expect(() =>
      m.spawn({
        id: 'd',
        taskId: 't',
        cwd: os.tmpdir(),
        command: '/bin/sh',
        args: [],
      }),
    ).toThrow(/already/);
    expect(m.ids()).toEqual(['d']);
    m.kill('d');
  });
});
