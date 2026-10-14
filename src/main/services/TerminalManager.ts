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
  /** Resolves when the process exits, also after the entry was replaced or forgotten. */
  exit: Promise<void>;
};

const BUFFER_LIMIT = 200_000;
/** How long kill waits for the exit before giving up (a process that ignores the kill must not block Finish). */
const KILL_WAIT_MS = 3000;

/** The exit code reported when the pty closed before the code was known (node-pty with conpty.dll). */
export const UNKNOWN_EXIT = -1;

export const normaliseExitCode = (code: unknown): number =>
  typeof code === 'number' && Number.isFinite(code) ? code : UNKNOWN_EXIT;

/** One pty per terminal id. Exited terminals stay known (for restart and buffer) until killed. */
export class TerminalManager extends EventEmitter<{
  data: [id: string, data: string];
  exit: [id: string, exitCode: number];
}> {
  private readonly entries = new Map<string, Entry>();
  private readonly killWaitMs: number;

  constructor(o: { killWaitMs?: number } = {}) {
    super();
    this.killWaitMs = o.killWaitMs ?? KILL_WAIT_MS;
  }

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
      // Windows: the bundled conpty.dll. The default (system ConPTY) kill path forks a helper with
      // child_process.fork, which the RunAsNode fuse turns into a second MIAC.exe launch.
      // node-pty is pinned to 1.2.0-beta.15 or later: 1.1.0 has a data race on its Windows pty handle
      // list (microsoft/node-pty#921, fixed in 1.2.0-beta.13) that crashes the process with an access
      // violation when one pty exits while another is spawned, resized or killed.
      ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
    });
    let exitResolve = () => {};
    const exit = new Promise<void>((r) => {
      exitResolve = r;
    });
    const entry: Entry = { options, proc, exited: false, buffer: '', exit };
    this.entries.set(options.id, entry);
    proc.onData((data) => {
      if (this.entries.get(options.id) !== entry) return;
      entry.buffer = (entry.buffer + data).slice(-BUFFER_LIMIT);
      this.emit('data', options.id, data);
    });
    proc.onExit(({ exitCode }) => {
      exitResolve();
      if (this.entries.get(options.id) !== entry) return;
      entry.exited = true;
      this.emit('exit', options.id, normaliseExitCode(exitCode));
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

  /**
   * Kills and forgets a terminal. Resolves when the process has exited, or after the fallback wait,
   * so a caller can then remove the folder it ran in (Windows refuses while a process has it as cwd).
   * Callers that do not need to wait can ignore the promise.
   */
  kill(id: string): Promise<void> {
    const e = this.entries.get(id);
    if (!e) return Promise.resolve();
    this.entries.delete(id);
    if (e.exited) return Promise.resolve();
    let timer: NodeJS.Timeout | undefined;
    const fallback = new Promise<void>((r) => {
      timer = setTimeout(r, this.killWaitMs);
    });
    try {
      e.proc.kill();
    } catch {
      // Already gone; the exit (or the fallback) settles the wait.
    }
    return Promise.race([e.exit, fallback]).finally(() => clearTimeout(timer));
  }

  restart(id: string): void {
    const old = this.get(id);
    void this.kill(id);
    try {
      this.spawn(old.options);
    } catch (error) {
      // Keep the terminal known (and its scrollback readable) when the respawn fails.
      old.exited = true;
      this.entries.set(id, old);
      throw error;
    }
  }

  /** Kills every terminal of a task. Resolves when they have all exited (see kill). */
  async killAllForTask(taskId: string): Promise<void> {
    const ids = [...this.entries]
      .filter(([, e]) => e.options.taskId === taskId)
      .map(([id]) => id);
    await Promise.all(ids.map((id) => this.kill(id)));
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

  has(id: string): boolean {
    return this.entries.has(id);
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
