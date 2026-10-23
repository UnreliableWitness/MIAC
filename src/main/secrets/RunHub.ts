import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import {
  isGuarded,
  type Environment,
  type PendingRun,
} from '../../shared/secrets';
import type { ShellieConfig } from '../../shared/types';
import { errorMessage } from '../../shared/errors';

/** The start of the last line of a `/v1/run` response: `\0exit:<code>`. Output never holds a NUL. */
export const RUN_EXIT = '\u0000exit:';

/** What a `shellie run` needs to know about the task. */
export type RunTask = {
  id: string;
  /** Only a ready task runs commands. */
  ready: boolean;
  environment: Environment;
  /** The task's setup commands (`setup`). */
  setupCommands: string[];
  /** The task's active workspaces, home first. `repoPath` is the repo's main checkout. */
  workspaces: { id: string; repoPath: string; worktreePath: string }[];
  /** The task's agent tabs (Claude Code, Copilot, OpenCode). */
  agentTabs: string[];
};

/** A resolved named command. `command` is the repo's own line from .shellie.yml (or the test command). */
export type RunSpec = {
  name: string;
  given: 'run' | 'tests' | 'setup';
  command: string | null;
  setupCommands: string[] | null;
  /** Passed as arguments, never through a shell line. */
  args: string[];
  workspaceId: string;
  /** The environment the run was resolved (and approved) for; the tab refuses to start on another. */
  environment: Environment;
};

type Filter = (
  o: { id: string; taskId: string },
  data: string,
  carry: string,
  final: boolean,
) => { text: string; carry: string };

/** Main's side (handlers): the task, its config, the tabs, leak watch and the renderer. */
export type RunBackend = {
  task(taskId: string): RunTask | null;
  /** The repo's .shellie.yml (from its main checkout). */
  config(repoPath: string): Promise<ShellieConfig>;
  testCommand(
    worktreePath: string,
    config: ShellieConfig,
  ): Promise<string | null>;
  /**
   * Opens (or reuses) the visible run tab `agent · <name>` and spawns the command with the task environment's
   * secrets. Calls `attach` with the tab's id right before the spawn, so no output is missed.
   */
  openTab(
    taskId: string,
    spec: RunSpec,
    attach: (terminalId: string) => void,
  ): Promise<void>;
  kill(terminalId: string): void;
  /** Leak watch's filter, the same as agent tabs' output goes through. */
  filter: Filter;
  /** The runs waiting for an approve changed (`runs:pending`). */
  pending(list: PendingRun[]): void;
};

export type StartOptions = {
  /** The folder the agent ran `shellie run` in (`$PWD`); picks the workspace. */
  workspace?: string;
  /** The agent tab that asked (`$SHELLIE_TERMINAL_ID`); leak notices go to it. */
  terminal?: string;
  /** Aborted when the caller goes away (the agent cancelled): the run stops. */
  signal?: AbortSignal;
};

type Running = {
  taskId: string;
  name: string;
  workspaceId: string;
  terminalId: string | null;
  /** The tab leak notices go to. */
  noticeId: string | null;
  carry: string;
  out: (chunk: string) => void;
  finish: (code: number, message?: string) => void;
};

type Waiting = PendingRun & { decide: (ok: boolean | string) => void };

const MAX_ARGS = 200;
const MAX_ARG_LENGTH = 32_768;

/** Whether `folder` is `root` or inside it (path.relative is case-insensitive on Windows). */
function inside(root: string, folder: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(folder));
  return (
    rel === '' ||
    (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`))
  );
}

/**
 * `shellie run` for agents: runs a task's **named** commands (the repo's `run:` entries, `test`, `setup`) in a
 * visible `run` tab with the task environment's secrets, and streams the tab's output back to the agent only
 * after leak filtering. A token per task per launch says which task a request is for. UAT and Production runs
 * wait for an approve in Shellie. Never a free command line: the name picks the command, arguments stay arguments.
 */
export class RunHub {
  private backend: RunBackend | null = null;
  private readonly tokens = new Map<string, string>();
  private readonly runs = new Set<Running>();
  private readonly waiting = new Map<string, Waiting>();
  private readonly random: () => string;

  constructor(o: { random?: () => string } = {}) {
    this.random = o.random ?? (() => randomBytes(24).toString('hex'));
  }

  attach(backend: RunBackend): void {
    this.backend = backend;
  }

  /** The task's token for this launch (made on first use). */
  tokenFor(taskId: string): string {
    let t = this.tokens.get(taskId);
    if (!t) {
      t = this.random();
      this.tokens.set(taskId, t);
    }
    return t;
  }

  /** The task a token is for, compared in constant time; null when it is no task's. */
  taskFor(token: string): string | null {
    const given = Buffer.from(token, 'utf8');
    let found: string | null = null;
    for (const [taskId, t] of this.tokens) {
      const mine = Buffer.from(t, 'utf8');
      if (mine.length === given.length && timingSafeEqual(mine, given))
        found = taskId;
    }
    return found;
  }

  /** The names an agent can run in the task (in the workspace `folder` is in, else the home). */
  async names(taskId: string, folder?: string): Promise<string[]> {
    const task = this.backend?.task(taskId);
    if (!task) return [];
    return (await this.catalog(task, folder)).names;
  }

  /** The named command, or why not. `args` are passed as they are, never through a shell line. */
  async resolve(
    taskId: string,
    name: string,
    args: string[],
    folder?: string,
  ): Promise<RunSpec | { error: string }> {
    const task = this.backend?.task(taskId);
    if (!task) return { error: 'This task is not in Shellie' };
    const { names, ws, run, test } = await this.catalog(task, folder);
    const list =
      names.length > 0
        ? `Commands for shellie run: ${names.join(', ')}`
        : 'This task has no commands for shellie run; add them under run: in .shellie.yml';
    if (!names.includes(name))
      return { error: `Unknown command "${name}". ${list}` };
    if (args.length > MAX_ARGS) return { error: 'Too many arguments' };
    if (args.some((a) => a.length > MAX_ARG_LENGTH))
      return { error: 'An argument is too long' };
    if (args.some((a) => a.includes('\0')))
      return { error: 'An argument holds a NUL character' };
    const base = {
      name,
      args,
      workspaceId: ws.id,
      environment: task.environment,
    };
    if (Object.hasOwn(run, name))
      return {
        ...base,
        given: name === 'test' ? 'tests' : 'run',
        command: run[name]!,
        setupCommands: null,
      };
    if (name === 'test')
      return { ...base, given: 'tests', command: test, setupCommands: null };
    if (args.length > 0) return { error: 'setup takes no arguments' };
    return {
      ...base,
      given: 'setup',
      command: null,
      setupCommands: task.setupCommands,
    };
  }

  /**
   * Runs the named command and streams its leak-filtered output to `out`; resolves with its exit code (1 when it
   * was refused, not approved, stopped or could not start, with the reason in the output).
   */
  async start(
    taskId: string,
    name: string,
    args: string[],
    out: (chunk: string) => void,
    o: StartOptions = {},
  ): Promise<number> {
    const say = (line: string) => {
      out(`${line}\n`);
      return 1;
    };
    const backend = this.backend;
    if (!backend) return say('Shellie is still starting; try again');
    const task = backend.task(taskId);
    if (!task?.ready) return say('This task is not ready in Shellie');
    const spec = await this.resolve(taskId, name, args, o.workspace);
    if ('error' in spec) return say(spec.error);
    const label = `agent · ${spec.name}`;
    if (o.signal?.aborted) return 1;
    if (
      [...this.runs].some(
        (r) =>
          r.taskId === taskId &&
          r.name === spec.name &&
          r.workspaceId === spec.workspaceId,
      )
    )
      return say(`${label} is already running in Shellie; stop it there first`);

    const run: Running = {
      taskId,
      name: spec.name,
      workspaceId: spec.workspaceId,
      terminalId: null,
      noticeId:
        o.terminal && task.agentTabs.includes(o.terminal) ? o.terminal : null,
      carry: '',
      out: (chunk) => out(chunk.replaceAll('\0', '')),
      finish: () => undefined,
    };
    // Held from here, so a second run of the name is refused while this one waits for its approve.
    this.runs.add(run);
    const result = new Promise<number>((resolve) => {
      run.finish = (code, message) => {
        if (!this.runs.delete(run)) return;
        this.flush(run);
        if (message) run.out(`\n${message}\n`);
        resolve(code);
      };
    });
    const onAbort = () => {
      if (run.terminalId) backend.kill(run.terminalId);
      run.finish(1);
    };
    o.signal?.addEventListener('abort', onAbort, { once: true });
    void (async () => {
      if (isGuarded(spec.environment)) {
        const ok = await this.approval(taskId, spec, run, o.signal);
        if (!this.runs.has(run)) return;
        if (ok !== true) {
          if (typeof ok === 'string') run.finish(1, ok);
          else {
            run.out('Not approved in Shellie\n');
            run.finish(1);
          }
          return;
        }
      }
      if (!this.runs.has(run)) return;
      // TODO(telemetry): secrets.runStarted kind=<run|test|setup> environment
      try {
        await backend.openTab(taskId, spec, (id) => {
          run.terminalId = id;
          run.noticeId ??= id;
        });
      } catch (e) {
        if (!this.runs.has(run)) return;
        run.out(`Shellie could not start ${label}: ${errorMessage(e)}\n`);
        run.finish(1);
      }
    })();
    const code = await result;
    o.signal?.removeEventListener('abort', onAbort);
    return code;
  }

  /** Output of a terminal: passed on, leak filtered, when a run owns it. */
  data(terminalId: string, data: string): void {
    const run = this.byTerminal(terminalId);
    if (!run || !this.backend) return;
    const r = this.backend.filter(
      { id: run.noticeId ?? terminalId, taskId: run.taskId },
      data,
      run.carry,
      false,
    );
    run.carry = r.carry;
    run.out(r.text);
  }

  /** A terminal exited: its run ends with the exit code. */
  exit(terminalId: string, code: number): void {
    this.byTerminal(terminalId)?.finish(code);
  }

  /** A run's tab was stopped, closed or restarted in Shellie: the run ends (the process is already gone). */
  tabGone(terminalId: string, reason = 'Stopped in Shellie'): void {
    this.byTerminal(terminalId)?.finish(1, reason);
  }

  /** Ends the task's runs (and drops its waiting ones), e.g. "Production ended". Their tabs are stopped. */
  stopForTask(taskId: string, reason = 'Stopped in Shellie'): void {
    for (const w of this.waiting.values())
      if (w.taskId === taskId) w.decide(reason);
    for (const run of this.runs)
      if (run.taskId === taskId) {
        if (run.terminalId) this.backend?.kill(run.terminalId);
        run.finish(1, reason);
      }
  }

  /** The runs waiting for an approve (the renderer asks on load). */
  pendingRuns(): PendingRun[] {
    return [...this.waiting.values()].map(({ decide: _decide, ...p }) => p);
  }

  /** The developer's answer to a waiting run. */
  approve(id: string, ok: boolean): void {
    this.waiting.get(id)?.decide(ok);
  }

  private approval(
    taskId: string,
    spec: RunSpec,
    run: Running,
    signal: AbortSignal | undefined,
  ): Promise<boolean | string> {
    run.out('Waiting for your approve in Shellie…\n');
    return new Promise((resolve) => {
      const id = this.random();
      const done = (ok: boolean | string) => {
        if (!this.waiting.delete(id)) return;
        signal?.removeEventListener('abort', onAbort);
        this.backend?.pending(this.pendingRuns());
        resolve(ok);
      };
      const onAbort = () => done(false);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.set(id, {
        id,
        taskId,
        name: spec.name,
        command: spec.setupCommands
          ? spec.setupCommands.join(' && ')
          : (spec.command ?? ''),
        args: spec.args,
        environment: spec.environment,
        decide: done,
      });
      this.backend?.pending(this.pendingRuns());
    });
  }

  private flush(run: Running): void {
    if (!run.carry || !this.backend) return;
    const r = this.backend.filter(
      { id: run.noticeId ?? run.terminalId ?? '', taskId: run.taskId },
      '',
      run.carry,
      true,
    );
    run.carry = '';
    run.out(r.text);
  }

  private byTerminal(terminalId: string): Running | undefined {
    for (const r of this.runs) if (r.terminalId === terminalId) return r;
    return undefined;
  }

  /** The names in the workspace `folder` is in (else the home), with what they resolve from. */
  private async catalog(task: RunTask, folder: string | undefined) {
    const home = task.workspaces[0]!;
    const ws =
      (folder
        ? [...task.workspaces]
            // The deepest worktree that holds the folder (a worktree can sit inside another repo's folder).
            .sort((a, b) => b.worktreePath.length - a.worktreePath.length)
            .find((w) => inside(w.worktreePath, folder))
        : undefined) ?? home;
    const config = await this.backend!.config(ws.repoPath);
    const run = config.run;
    const test = await this.backend!.testCommand(ws.worktreePath, config);
    const names = Object.keys(run);
    if (test !== null && !names.includes('test')) names.push('test');
    if (task.setupCommands.length > 0 && !names.includes('setup'))
      names.push('setup');
    return { names, ws, run, test };
  }
}
