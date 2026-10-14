import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';

export type SpawnOptions = {
  id: string;
  taskId: string;
  cwd: string;
  command: string;
  args: string[];
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
};

type Entry = {
  options: SpawnOptions;
  proc: pty.IPty;
  exited: boolean;
  buffer: string;
};

const BUFFER_LIMIT = 200_000;

/** One pty per terminal id. Exited terminals stay known (for restart and buffer) until killed. */
export class TerminalManager extends EventEmitter<{
  data: [id: string, data: string];
  exit: [id: string, exitCode: number];
}> {
  private readonly entries = new Map<string, Entry>();

  spawn(options: SpawnOptions): void {
    if (this.entries.has(options.id))
      throw new Error(`Terminal ${options.id} already exists`);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env))
      if (v !== undefined) env[k] = v;
    Object.assign(env, options.env ?? {});
    env.TERM = 'xterm-256color';
    env.MIAC_TASK_ID = options.taskId;
    const proc = pty.spawn(options.command, options.args, {
      name: 'xterm-256color',
      cols: options.cols ?? 120,
      rows: options.rows ?? 30,
      cwd: options.cwd,
      env,
    });
    const entry: Entry = { options, proc, exited: false, buffer: '' };
    this.entries.set(options.id, entry);
    proc.onData((data) => {
      if (this.entries.get(options.id) !== entry) return;
      entry.buffer = (entry.buffer + data).slice(-BUFFER_LIMIT);
      this.emit('data', options.id, data);
    });
    proc.onExit(({ exitCode }) => {
      if (this.entries.get(options.id) !== entry) return;
      entry.exited = true;
      this.emit('exit', options.id, exitCode);
    });
  }

  write(id: string, data: string): void {
    const e = this.get(id);
    if (!e.exited) e.proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const e = this.get(id);
    if (!e.exited)
      e.proc.resize(
        Math.max(2, Math.floor(cols)),
        Math.max(1, Math.floor(rows)),
      );
  }

  kill(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    if (!e.exited) e.proc.kill();
    this.entries.delete(id);
  }

  restart(id: string): void {
    const old = this.get(id);
    this.kill(id);
    try {
      this.spawn(old.options);
    } catch (error) {
      // Keep the terminal known (and its scrollback readable) when the respawn fails.
      old.exited = true;
      this.entries.set(id, old);
      throw error;
    }
  }

  killAllForTask(taskId: string): void {
    for (const [id, e] of this.entries)
      if (e.options.taskId === taskId) this.kill(id);
  }

  runningCount(taskId: string): number {
    let n = 0;
    for (const e of this.entries.values())
      if (e.options.taskId === taskId && !e.exited) n++;
    return n;
  }

  isRunning(id: string): boolean {
    const e = this.entries.get(id);
    return Boolean(e && !e.exited);
  }

  buffer(id: string): string {
    return this.get(id).buffer;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  private get(id: string): Entry {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Unknown terminal ${id}`);
    return e;
  }
}
