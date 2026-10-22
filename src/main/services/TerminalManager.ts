import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';
import type { ColorScheme } from '../../shared/theme';

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
  /** The program turned on colour scheme reports (DEC private mode 2031), so a scheme change is pushed to it. */
  schemeReports: boolean;
  /** The last characters of the output, so a mode switch split over two chunks is still seen. */
  tail: string;
  /** Resolves when the process exits, also after the entry was replaced or forgotten. */
  exit: Promise<void>;
  startedAt: number;
  exitedAt?: number;
};

const BUFFER_LIMIT = 200_000;
/** Longer than any `CSI ? … 2031 h` a program sends, so a split one is caught on the next chunk. */
const TAIL = 64;
/** DEC private mode set (h) or reset (l) with 2031 among its parameters. */
// eslint-disable-next-line no-control-regex -- matching the escape character is the point
const MODE_2031 = /\x1b\[\?(?:\d+;)*2031(?:;\d+)*([hl])/g;

/**
 * Whether colour scheme reports (mode 2031, Contour's dark/light notifications, used by Claude Code) are on after
 * `text`, given whether they were on before: the last set or reset in it wins.
 */
export function schemeReportsAfter(on: boolean, text: string): boolean {
  let last: string | undefined;
  for (const m of text.matchAll(MODE_2031)) last = m[1];
  return last === undefined ? on : last === 'h';
}

/** The report of a scheme change: CSI ? 997 ; 1 n for dark, 2 for light. */
export const schemeReport = (s: ColorScheme): string =>
  `\x1b[?997;${s === 'dark' ? 1 : 2}n`;
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
  private readonly now: () => number;

  constructor(o: { killWaitMs?: number; now?: () => number } = {}) {
    super();
    this.killWaitMs = o.killWaitMs ?? KILL_WAIT_MS;
    this.now = o.now ?? Date.now;
  }

  spawn(options: SpawnOptions): void {
    if (this.entries.has(options.id))
      throw new Error(`Terminal ${options.id} already exists`);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env))
      if (v !== undefined) env[k] = v;
    Object.assign(env, options.env ?? {});
    env.TERM = 'xterm-256color';
    // xterm.js draws 24-bit colour; without this, programs started from the Dock or Start menu (no COLORTERM in
    // the environment) fall back to 256 colours, which bends Claude Code's theme colours (as VS Code sets it).
    env.COLORTERM = 'truecolor';
    env.SHELLIE_TASK_ID = options.taskId;
    env.MIAC_TASK_ID = options.taskId; // for scripts written before the rename
    env.SHELLIE_TERMINAL_ID = options.id;
    const proc = pty.spawn(options.command, options.args, {
      name: 'xterm-256color',
      cols: options.cols ?? 120,
      rows: options.rows ?? 30,
      cwd: options.cwd,
      env,
      // Windows: the bundled conpty.dll. The default (system ConPTY) kill path forks a helper with
      // child_process.fork, which the RunAsNode fuse turns into a second Shellie.exe launch.
      // node-pty is pinned to 1.2.0-beta.15 or later: 1.1.0 has a data race on its Windows pty handle
      // list (microsoft/node-pty#921, fixed in 1.2.0-beta.13) that crashes the process with an access
      // violation when one pty exits while another is spawned, resized or killed.
      ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
    });
    let exitResolve = () => {};
    const exit = new Promise<void>((r) => {
      exitResolve = r;
    });
    const entry: Entry = {
      options,
      proc,
      exited: false,
      buffer: '',
      schemeReports: false,
      tail: '',
      exit,
      startedAt: this.now(),
    };
    this.entries.set(options.id, entry);
    proc.onData((data) => {
      if (this.entries.get(options.id) !== entry) return;
      // Trimmed lazily; buffer() returns only the last BUFFER_LIMIT characters.
      entry.buffer += data;
      const seen = entry.tail + data;
      entry.schemeReports = schemeReportsAfter(entry.schemeReports, seen);
      entry.tail = seen.slice(-TAIL);
      if (entry.buffer.length > 2 * BUFFER_LIMIT)
        entry.buffer = entry.buffer.slice(-BUFFER_LIMIT);
      this.emit('data', options.id, data);
    });
    proc.onExit(({ exitCode }) => {
      exitResolve();
      if (this.entries.get(options.id) !== entry) return;
      entry.exited = true;
      entry.exitedAt = this.now();
      this.emit('exit', options.id, normaliseExitCode(exitCode));
    });
  }

  write(id: string, data: string): void {
    const e = this.get(id);
    if (!e.exited) e.proc.write(data);
  }

  /**
   * Tells the program the colour scheme changed, when it asked for that (mode 2031). The renderer calls this after
   * it re-coloured the terminal, so a program that then asks for the background (OSC 11) gets the new one.
   */
  reportScheme(id: string, scheme: ColorScheme): void {
    const e = this.entries.get(id);
    if (e && !e.exited && e.schemeReports) e.proc.write(schemeReport(scheme));
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

  /** How long the terminal's process ran: until its exit, or until now while it runs; 0 for an unknown one. */
  runMs(id: string): number {
    const e = this.entries.get(id);
    return e ? (e.exitedAt ?? this.now()) - e.startedAt : 0;
  }

  buffer(id: string): string {
    return this.get(id).buffer.slice(-BUFFER_LIMIT);
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
