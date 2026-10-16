import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Events, Handlers, PendingUpdate } from '../../shared/ipc';
import {
  claudeContext,
  renderClaudeMd,
  renderTaskMd,
  taskSlug,
} from '../../shared/naming';
import {
  folderName,
  isFolderTask,
  patchWorktree,
  repoDir,
  terminalCwd,
  worktreesOf,
} from '../../shared/tasks';
import {
  claudeHasSessionsIn,
  claudeSessionExists,
} from '../services/claudeSessions';
import {
  REPO_HAS_WORK,
  type Connection,
  type GitFile,
  type GitSummary,
  type MiacConfig,
  type PullRequestRef,
  type RepoFinishCheck,
  type SetupEvent,
  type SetupState,
  type Task,
  type TaskStatus,
  type TaskSummary,
  type TaskView,
  type TaskWorktree,
  type TerminalDef,
  type WorkItemTypeMeta,
} from '../../shared/types';
import { defaultTasksFolder, worktreeRoot } from '../paths';
import { DocsWatcher } from '../docs/DocsWatcher';
import { createDocsHandlers } from '../docs/docsHandlers';
import type { Command, Platform } from '../platform/Platform';
import {
  OFFICIAL_RATES,
  OFFICIAL_RATES_AS_OF,
  OFFICIAL_USD_TO_EUR,
} from '../pricing/officialRates';
import { AdoClient, AdoError } from '../services/AdoClient';
import type { AdoRegistry } from '../services/AdoRegistry';
import {
  TokenUnavailableError,
  type ConnectionStore,
} from '../services/ConnectionStore';
import {
  prAvailability,
  prDescription,
  prTitle,
  prWebUrl,
  targetBranch,
} from '../services/azureRepos';
import type { GitClient } from '../services/GitClient';
import type { RepoRegistry } from '../services/RepoRegistry';
import {
  planSteps,
  type SetupPlan,
  type SetupRunner,
} from '../services/SetupRunner';
import type { TaskStore } from '../services/TaskStore';
import type { TerminalManager } from '../services/TerminalManager';
import { planStartUpdate } from '../services/workItemStart';
import type { CopilotFileTailer } from '../usage/CopilotFileTailer';
import { usageCsv } from '../usage/csv';
import type { SettingsStore } from '../usage/SettingsStore';
import { NoopTelemetry, type Telemetry } from '../telemetry/AppInsightsClient';
import { changedKeys } from '../telemetry/helpers';
import { telemetryEnv } from '../usage/telemetryEnv';
import type { UsageReceiver } from '../usage/UsageReceiver';
import type { UsageStore } from '../usage/UsageStore';
import { UsageSync } from '../usage/UsageSync';
import { renderCostLine } from '../../shared/workItemUsage';

export type Services = {
  store: TaskStore;
  git: GitClient;
  platform: Platform;
  repos: RepoRegistry;
  connections: ConnectionStore;
  ado: AdoRegistry;
  openExternal: (url: string) => Promise<void>;
  /** Shows a file in Finder or Explorer (main uses shell.showItemInFolder). */
  revealFile?: (absPath: string) => void;
  /** Owned by main so it can stop on quit; handlers create their own when absent (tests). */
  docsWatcher?: DocsWatcher;
  terminals: TerminalManager;
  runner: SetupRunner;
  loadConfig: (repoPath: string) => Promise<MiacConfig>;
  pickFolder: () => Promise<string | null>;
  launch: (cmd: Command) => Promise<void>;
  broadcast: <K extends keyof Events>(event: K, payload: Events[K]) => void;
  usage: UsageStore;
  settings: SettingsStore;
  appVersion: string;
  /** Windows OS build number (e.g. 22631), null elsewhere. */
  windowsBuild?: number | null;
  receiver: Pick<UsageReceiver, 'start' | 'status'>;
  copilot: Pick<CopilotFileTailer, 'stats' | 'poll'>;
  usageDir: string;
  /** Registers a function to run every hour (main uses setInterval; tests capture it). */
  onHourly: (fn: () => void) => void;
  /** How long Finish waits after closing terminals so the last telemetry batch arrives (main 2500, tests 0). */
  finishFlushMs: number;
  /** App telemetry (usage, errors, timings); see docs/telemetry.md. Defaults to sending nothing. */
  telemetry?: Telemetry;
  /** Adds values telemetry must scrub from now on, such as the project and repo of a remote. */
  rememberSensitive?: (values: string[]) => void;
  /** Whether Claude Code saved a session with this id (default: looks in ~/.claude/projects). */
  claudeSessionExists?: (sessionId: string) => boolean;
  /** Whether Claude Code saved any session for this folder (default: looks in ~/.claude/projects). */
  claudeHasSessionsIn?: (cwd: string) => boolean;
  /** How new tasks are laid out: a task folder with a worktree per repo (default), or the older single worktree. */
  newTaskLayout?: 'folder' | 'worktree';
  /** Windows auto-update: the downloaded update and how to apply it. Absent in dev, on macOS and in tests. */
  update?: {
    pending(): PendingUpdate | null;
    /** Quits and starts the update; false when none is downloaded. */
    install(): boolean;
  };
};

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** After a crash, tasks cannot still be mid-setup or mid-finish. Returns how many were changed. */
export async function recoverInterruptedTasks(
  store: TaskStore,
): Promise<number> {
  let changed = 0;
  await store.update((s) => {
    for (const t of s.tasks) {
      if (t.status === 'setting-up') {
        t.status = 'setup-failed';
        changed++;
      } else if (t.status === 'finishing') {
        t.status = 'ready';
        changed++;
      }
      // A repo that was being added when MIAC stopped.
      for (const w of t.worktrees ?? [])
        if (w.status === 'setting-up') {
          w.status = 'setup-failed';
          changed++;
        }
    }
  });
  return changed;
}

/** Keys (repo:branch, repo:worktree) of tasks being created right now, across handler bundles. */
const creating = new Set<string>();

/** Clears connection links that point at connections which no longer exist. Returns how many were cleared. */
export async function pruneDanglingConnectionLinks(
  repos: RepoRegistry,
  connections: ConnectionStore,
): Promise<number> {
  const valid = new Set(connections.list().map((c) => c.id));
  let cleared = 0;
  for (const r of repos.list()) {
    if (r.connectionId !== null && !valid.has(r.connectionId)) {
      await repos.setConnection(r.id, null);
      cleared++;
    }
  }
  return cleared;
}

export function createHandlers(s: Services): Handlers {
  const tel = s.telemetry ?? NoopTelemetry;
  const sessionExists = s.claudeSessionExists ?? claudeSessionExists;
  const hasSessionsIn = s.claudeHasSessionsIn ?? claudeHasSessionsIn;
  const connectionsChanged = () =>
    s.broadcast('connections:changed', s.connections.list());

  /** Work item types per connection, with icons, for the session. A failed load is not kept, so the next call retries. */
  const typesCache = new Map<string, Promise<WorkItemTypeMeta[]>>();
  const dropTypes = (connectionId: string) => typesCache.delete(connectionId);

  /** Runs an Azure DevOps call for a connection; a rejected token flips the status so Settings and the footer turn red. */
  const withConnection = async <T>(
    connectionId: string,
    run: () => Promise<T>,
  ): Promise<T> => {
    let result: T;
    try {
      result = await run();
    } catch (e) {
      const status =
        (e instanceof AdoError && e.kind === 'unauthorized') ||
        e instanceof TokenUnavailableError
          ? 'unauthorized'
          : e instanceof AdoError && e.kind === 'unreachable'
            ? 'unreachable'
            : null;
      if (status) {
        try {
          await s.connections.setStatus(connectionId, status);
          connectionsChanged();
        } catch {
          // The connection may be gone; keep the original error.
        }
      }
      throw e;
    }
    // A working call proves the token is fine again; heal a stale red status.
    try {
      const current = s.connections.get(connectionId);
      if (current.status !== 'ok') {
        await s.connections.setStatus(connectionId, 'ok');
        connectionsChanged();
      }
    } catch {
      // Status bookkeeping must never fail a successful call.
    }
    return result;
  };

  const verifyConnection = async (
    connectionId: string,
  ): Promise<Connection> => {
    const c = s.connections.get(connectionId);
    const { user, uniqueName } = await withConnection(connectionId, () =>
      s.ado.client(connectionId).verify(c.project),
    );
    const updated = await s.connections.setStatus(
      connectionId,
      'ok',
      user,
      uniqueName,
    );
    connectionsChanged();
    return updated;
  };

  const allowedExternal = (url: string): boolean => {
    try {
      const u = new URL(url);
      return (
        u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        u.port === '' &&
        (u.hostname === 'dev.azure.com' ||
          u.hostname.endsWith('.visualstudio.com'))
      );
    } catch {
      return false;
    }
  };

  /** Setup states by task, and by task and repo for a repo being added. */
  const setupStates = new Map<string, SetupState>();
  const setupKey = (taskId: string, repoId?: string) =>
    repoId ? `${taskId}:${repoId}` : taskId;
  const inFlight = new Set<string>();
  /** Tasks with a repo being added or removed: one change at a time, while the task itself stays usable. */
  const repoChanging = new Set<string>();
  /** A Move: the repo to remove once the added one (by setup key) is ready. */
  const pendingReplace = new Map<string, string>();

  /** Synchronous guard: call before the first await of an operation that changes a task's status. */
  const claim = (taskId: string, allowed: TaskStatus[], action: string) => {
    const status = taskById(taskId).status;
    if (!allowed.includes(status))
      throw new Error(`Cannot ${action} a task that is ${status}`);
    if (inFlight.has(taskId)) throw new Error('Task is busy');
    inFlight.add(taskId);
  };
  const release = (taskId: string) => {
    inFlight.delete(taskId);
  };

  const taskById = (id: string): Task => {
    const t = s.store.state.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`Unknown task ${id}`);
    return t;
  };

  const listTasks = async (): Promise<TaskView[]> =>
    Promise.all(
      s.store.state.tasks.map(async (t) => ({
        ...t,
        worktreeMissing:
          t.status !== 'done' &&
          t.status !== 'setting-up' &&
          !(await exists(t.worktreePath)),
      })),
    );

  const tasksChanged = async () =>
    s.broadcast('tasks:changed', await listTasks());

  const patchTask = async (id: string, patch: Partial<Task>) => {
    await s.store.update((st) => {
      const t = st.tasks.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
    });
    await tasksChanged();
  };

  /** Changes a stored task in place (never from a stale snapshot) and broadcasts. */
  const mutateTask = async (id: string, change: (t: Task) => void) => {
    await s.store.update((st) => {
      const t = st.tasks.find((x) => x.id === id);
      if (t) change(t);
    });
    await tasksChanged();
  };

  const repoName = (repoId: string) =>
    s.repos.list().find((r) => r.id === repoId)?.name ?? repoId;

  const worktreeOf = (task: Task, repoId: string): TaskWorktree => {
    const w = worktreesOf(task).find((x) => x.repoId === repoId);
    if (!w) throw new Error('That repo is not in this task');
    return w;
  };

  /** The files MIAC keeps in a task folder. The notes file is written once and then left to the user. */
  const taskFilesFor = async (taskId: string) => {
    const t = taskById(taskId);
    const repos = await Promise.all(
      worktreesOf(t).map(async (w) => ({
        dir: w.dir,
        name: repoName(w.repoId),
        hasClaudeMd: await exists(path.join(w.path, 'CLAUDE.md')),
      })),
    );
    const files = [{ rel: 'CLAUDE.md', content: renderClaudeMd(t, repos) }];
    if (!(await exists(path.join(t.worktreePath, '.miac', 'task.md'))))
      files.push({ rel: '.miac/task.md', content: renderTaskMd(t) });
    return files;
  };

  const writeTaskFiles = async (taskId: string) => {
    const folder = taskById(taskId).worktreePath;
    for (const f of await taskFilesFor(taskId)) {
      const dest = path.join(folder, f.rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, f.content, 'utf8');
    }
  };

  /** Removes what MIAC wrote into a task folder, then the folder if nothing else is in it. */
  const removeTaskFolder = async (folder: string) => {
    await fs.rm(path.join(folder, 'CLAUDE.md'), { force: true });
    await fs.rm(path.join(folder, '.miac'), { recursive: true, force: true });
    await fs.rmdir(folder).catch(() => undefined);
  };

  /** Types a one-line note into every running Claude Code tab of the task, without Enter: the user sends it. */
  const tellClaude = (taskId: string, note: string) => {
    // The trailing space keeps a second note apart when the first was not sent yet.
    const line = `MIAC: ${note} `.replace(/[\r\n]+/g, ' ');
    for (const d of taskById(taskId).terminals)
      if (d.kind === 'claude' && s.terminals.isRunning(d.id))
        s.terminals.write(d.id, line);
  };

  /** Where a task's pull request would go: the repo's connection and its `origin` parsed as Azure Repos. */
  const prContext = async (task: Task, repoId: string = task.repoId) => {
    const w = worktreeOf(task, repoId);
    const repo = s.repos.get(repoId);
    const connection = repo.connectionId
      ? s.connections.get(repo.connectionId)
      : null;
    const remotes = await s.git.remotes(repo.path).catch(() => [] as string[]);
    const remoteUrl = remotes.includes('origin')
      ? await s.git.remoteUrl(repo.path, 'origin')
      : null;
    const availability = prAvailability({
      remoteUrl,
      connectionOrgUrl: connection?.organizationUrl ?? null,
    });
    // ADO 404 messages and git push errors name them; they may differ from the connection and folder names.
    if (availability.target)
      s.rememberSensitive?.([
        availability.target.project,
        availability.target.repo,
      ]);
    return {
      connection,
      availability,
      target: targetBranch(w.baseRef, remotes),
    };
  };

  /** Cost goes to Azure DevOps (work items, PR descriptions) only when the user turned it on. */
  const writeCost = () => s.settings.get().writeCostToAdo;
  const costLineFor = (taskId: string) =>
    writeCost() ? renderCostLine(s.usage.summarize(taskId)) : null;

  const usageSync = new UsageSync({
    task: taskById,
    tasks: () => s.store.state.tasks,
    target: (task) => {
      const connectionId =
        s.repos.list().find((r) => r.id === task.repoId)?.connectionId ?? null;
      if (!connectionId) return null;
      try {
        return {
          connectionId,
          project: s.connections.get(connectionId).project,
        };
      } catch {
        return null;
      }
    },
    client: (connectionId) => s.ado.client(connectionId),
    run: withConnection,
    usage: (taskId) => s.usage.summarize(taskId),
    changedSince: (iso) => s.usage.changedSince(iso),
    patchTask,
  });
  s.usage.on('changed', (taskId) => s.broadcast('usage:changed', { taskId }));
  s.onHourly(() => {
    if (s.settings.get().hourlySync && writeCost())
      usageSync
        .syncChanged()
        .catch((e) => console.error('[usage] hourly sync failed', e));
  });
  const receiverStatus = () => ({
    ...s.receiver.status,
    copilot: s.copilot.stats,
  });

  /** Applies a change to the stored terminal list of a task (never from a stale snapshot). */
  const updateTerminals = async (
    id: string,
    change: (list: TerminalDef[]) => TerminalDef[],
  ) => {
    await s.store.update((st) => {
      const t = st.tasks.find((x) => x.id === id);
      if (t) t.terminals = change(t.terminals);
    });
    await tasksChanged();
  };

  /**
   * Claude Code starts with the task in its system prompt and waits for the user. Resuming continues the tab's own
   * session, starts it again when the user never sent a message (nothing was saved), or continues the latest
   * session in the worktree for tabs from before session ids.
   */
  const terminalCommand = (
    task: Task,
    def: TerminalDef,
    resume = false,
  ): Command => {
    if (def.kind === 'claude') {
      if (resume && !def.sessionId)
        return s.platform.claudeCommand(null, ['--continue']);
      if (resume && def.sessionId && sessionExists(def.sessionId))
        return s.platform.claudeCommand(null, ['--resume', def.sessionId]);
      return s.platform.claudeCommand(
        claudeContext(task),
        def.sessionId ? ['--session-id', def.sessionId] : [],
      );
    }
    if (def.kind === 'run' && def.command)
      return s.platform.runCommand(def.command);
    if (def.kind === 'copilot') return s.platform.copilotCommand();
    if (def.kind === 'opencode') return s.platform.opencodeCommand();
    return s.platform.interactiveShell();
  };

  const spawnTerminal = (task: Task, def: TerminalDef, resume = false) => {
    const cmd = terminalCommand(task, def, resume);
    s.terminals.spawn({
      id: def.id,
      taskId: task.id,
      cwd: terminalCwd(task, def),
      command: cmd.command,
      args: cmd.args,
      env: {
        ...telemetryEnv(task.id, s.settings.get().receiverPort, s.usageDir),
        ...cmd.env,
      },
    });
  };

  const initialTerminals = (task: Task): TerminalDef[] => {
    const defs: TerminalDef[] = [];
    if (task.setup.startClaude)
      defs.push({
        id: randomUUID(),
        kind: 'claude',
        label: 'Claude Code',
        sessionId: randomUUID(),
      });
    if (task.setup.openCopilot)
      defs.push({ id: randomUUID(), kind: 'copilot', label: 'Copilot CLI' });
    // In a task folder the shell opens in the home repo, where git and the dev tools work.
    if (task.setup.openShell)
      defs.push({
        id: randomUUID(),
        kind: 'shell',
        label: s.platform.shellLabel,
        ...(isFolderTask(task) ? { repoId: task.repoId } : {}),
      });
    return defs;
  };

  /**
   * The tabs a reopened task gets back: those it had at Finish, or for tasks finished before that was kept, the
   * ones setup opens. A Claude tab without a session id continues the folder's latest session when there is one.
   */
  const restoredTerminals = (task: Task): TerminalDef[] => {
    const defs =
      task.closedTerminals.length > 0
        ? task.closedTerminals
        : initialTerminals(task).map((d): TerminalDef => {
            const { sessionId: _, ...rest } = d as TerminalDef;
            return rest;
          });
    return defs.map((d) =>
      d.kind === 'claude' && !d.sessionId && !hasSessionsIn(task.worktreePath)
        ? { ...d, sessionId: randomUUID() }
        : d,
    );
  };

  /** Starts a reopened task's tabs: Claude resumes, the rest start as before; running ones are left alone. */
  const startRestored = (task: Task, defs: TerminalDef[]) => {
    for (const def of defs) {
      if (s.terminals.isRunning(def.id)) continue;
      if (s.terminals.has(def.id)) void s.terminals.kill(def.id);
      spawnTerminal({ ...task, terminals: defs }, def, true);
      tel.event('terminal.opened', { kind: def.kind, initial: true });
    }
  };

  const applySetupEvent = (state: SetupState, e: SetupEvent) => {
    if (e.type === 'log') state.log.push(e.line);
    else if (e.type === 'step') {
      const step = state.steps[e.index];
      if (step) {
        step.status = e.status;
        step.detail = e.detail ?? step.detail;
        step.ms = e.ms ?? step.ms;
      }
    } else {
      state.finished = true;
      state.ok = e.ok;
      state.failedStep = e.failedStep ?? null;
    }
  };

  /** True while the work item should be moved and assigned by this setup: a new task with a linked work item. */
  const updatesWorkItem = (task: Task) => {
    const repo = s.repos.get(task.repoId);
    return (
      !task.reopen &&
      Boolean(
        task.workItem &&
        repo.connectionId &&
        (repo.workItemOnStart.moveToInProgress ||
          repo.workItemOnStart.assignToMe),
      )
    );
  };

  /** A task folder's setup: every repo (new task, reopen), or with `scope` only the repo being added. */
  const buildFolderPlan = async (
    task: Task,
    scope?: string,
  ): Promise<SetupPlan> => {
    const repos = await Promise.all(
      worktreesOf(task)
        .filter((w) => !scope || w.repoId === scope)
        .map(async (w) => {
          const repo = s.repos.get(w.repoId);
          const config = await s.loadConfig(repo.path);
          return {
            repoId: w.repoId,
            dir: w.dir,
            repoPath: repo.path,
            worktreePath: w.path,
            branch: w.branch,
            baseRef: w.baseRef,
            copy: w.copy ? config.copy : [],
            commands: w.commands,
            ...(task.reopen && !scope
              ? { restore: { from: w.reopen?.from ?? null } }
              : {}),
          };
        }),
    );
    const defs = scope
      ? []
      : task.reopen
        ? restoredTerminals(task)
        : initialTerminals(task);
    return {
      taskId: task.id,
      folder: task.worktreePath,
      repos,
      startTerminalsLabel:
        defs.length > 0 ? defs.map((d) => d.label).join(', ') : null,
      updateWorkItem: !scope && updatesWorkItem(task),
      ...(scope ? { scope } : {}),
    };
  };

  const buildPlan = async (task: Task, scope?: string): Promise<SetupPlan> => {
    if (isFolderTask(task)) return buildFolderPlan(task, scope);
    const repo = s.repos.get(task.repoId);
    const config = await s.loadConfig(repo.path);
    const defs = task.reopen ? restoredTerminals(task) : initialTerminals(task);
    return {
      taskId: task.id,
      repoPath: repo.path,
      worktreePath: task.worktreePath,
      branch: task.branch,
      baseRef: task.baseRef,
      copy: task.setup.copy ? config.copy : [],
      commands: task.setup.commands,
      taskMd: renderTaskMd(task),
      startTerminalsLabel:
        defs.length > 0 ? defs.map((d) => d.label).join(', ') : null,
      // A reopened task leaves its work item alone.
      updateWorkItem:
        !task.reopen &&
        Boolean(
          task.workItem &&
          repo.connectionId &&
          (repo.workItemOnStart.moveToInProgress ||
            repo.workItemOnStart.assignToMe),
        ),
      ...(task.reopen ? { restore: { from: task.reopen.from } } : {}),
    };
  };

  /**
   * Runs the setup. The caller must hold the in-flight claim (for `scope`, the repo-change lock); it is released
   * before the final 'finished' event. With `scope`, only that repo of a task folder is set up (Add repo).
   */
  const runSetup = async (
    taskId: string,
    fromStep?: number,
    scope?: string,
  ): Promise<void> => {
    let state: SetupState | undefined;
    let finishedEvent: SetupEvent | null = null;
    let addedOk = false;
    const key = setupKey(taskId, scope);
    const t0 = Date.now();
    let steps: ReturnType<typeof planSteps> = [];
    const report = (ok: boolean, failedStep: number | null) =>
      tel.event(
        scope ? 'task.repoAdded' : 'setup.finished',
        {
          ok,
          retry: fromStep !== undefined,
          failedStep:
            failedStep === null
              ? 'none'
              : (steps[failedStep]?.kind ?? 'unknown'),
          ...(scope ? { replaces: pendingReplace.has(key) } : {}),
        },
        { durationMs: Date.now() - t0, steps: steps.length },
      );
    const setStatus = async (ok: boolean) => {
      if (scope)
        await mutateTask(taskId, (t) =>
          patchWorktree(t, scope, { status: ok ? 'ready' : 'setup-failed' }),
        );
      else await patchTask(taskId, { status: ok ? 'ready' : 'setup-failed' });
    };
    try {
      const task = taskById(taskId);
      const plan = await buildPlan(task, scope);
      steps = planSteps(plan);
      const current: SetupState = {
        steps: steps.map((def) => ({ def, status: 'todo' })),
        log: [],
        finished: false,
        ok: null,
        failedStep: null,
      };
      state = current;
      setupStates.set(key, current);
      const result = await s.runner.run(plan, {
        fromStep,
        onEvent: (e) => {
          applySetupEvent(current, e);
          if (e.type === 'step' && e.ms !== undefined)
            tel.metric(
              `setup.step.${steps[e.index]?.kind ?? 'unknown'}`,
              e.ms,
              {
                status: e.status,
              },
            );
          // Hold back 'finished' until the task status is persisted, so listeners never see a stale status.
          if (e.type === 'finished') finishedEvent = e;
          else s.broadcast('setup', e);
        },
        onBaseSha: async (baseSha, repoId) => {
          if (repoId)
            await mutateTask(taskId, (t) =>
              patchWorktree(t, repoId, { baseSha }),
            );
          else await patchTask(taskId, { baseSha });
        },
        taskFiles: () => taskFilesFor(taskId),
        startTerminals: async () => {
          if (task.reopen) {
            const defs = restoredTerminals(task);
            startRestored(task, defs);
            await updateTerminals(taskId, () => defs);
            return;
          }
          const defs = initialTerminals(task);
          for (const def of defs) {
            spawnTerminal({ ...task, terminals: defs }, def);
            tel.event('terminal.opened', { kind: def.kind, initial: true });
          }
          await updateTerminals(taskId, (list) => [...list, ...defs]);
        },
        updateWorkItem: async () => {
          try {
            const repo = s.repos.get(task.repoId);
            const connection = s.connections.get(repo.connectionId!);
            const client = s.ado.client(connection.id);
            const id = Number(task.workItem!.id);
            const current = await client.workItemForStart(id);
            const states = await client.typeStates(
              connection.project,
              current.type,
            );
            // Connections saved before the unique name was stored have none; look it up once.
            let user = connection.userUniqueName;
            if (!user && repo.workItemOnStart.assignToMe)
              user = await verifyConnection(connection.id)
                .then((c) => c.userUniqueName)
                .catch(() => null);
            const plan = planStartUpdate(
              current,
              states,
              repo.workItemOnStart,
              user,
            );
            if (plan.state || plan.assignTo)
              await client.updateWorkItem(id, {
                ...(plan.state ? { state: plan.state } : {}),
                ...(plan.assignTo ? { assignedTo: plan.assignTo } : {}),
              });
            tel.event('workitem.startUpdated', {
              moved: Boolean(plan.state),
              assigned: Boolean(plan.assignTo),
            });
            return { detail: plan.detail, warn: false };
          } catch (e) {
            tel.event('workitem.startUpdated', { failed: true });
            throw e;
          }
        },
      });
      if (scope) {
        await setStatus(result.ok);
        addedOk = result.ok;
      } else
        await mutateTask(taskId, (t) => {
          if (!result.ok) {
            t.status = 'setup-failed';
            return;
          }
          t.status = 'ready';
          if (t.reopen) {
            t.reopen = null;
            t.finishedAt = null;
            t.closedTerminals = [];
          }
          for (const w of t.worktrees ?? []) {
            w.status = 'ready';
            w.reopen = null;
          }
        });
      report(result.ok, result.ok ? null : current.failedStep);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      report(false, null);
      tel.exception(e, { source: 'setup' });
      s.broadcast('notice', {
        level: 'error',
        message: `Setup failed: ${message}`,
      });
      if (state) {
        state.finished = true;
        state.ok = false;
      }
      finishedEvent = {
        taskId,
        ...(scope ? { repoId: scope } : {}),
        type: 'finished',
        ok: false,
      };
      try {
        await setStatus(false);
      } catch {
        // the store itself is failing; nothing more we can persist
      }
    } finally {
      if (scope) repoChanging.delete(taskId);
      else release(taskId);
    }
    if (scope && addedOk) await afterRepoAdded(taskId, scope);
    if (finishedEvent) s.broadcast('setup', finishedEvent);
  };

  const startSetupInBackground = (
    taskId: string,
    fromStep?: number,
    scope?: string,
  ) => {
    void runSetup(taskId, fromStep, scope);
  };

  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? '' : 's'}`;

  /** What removing a worktree would lose: commits since its base and uncommitted changes. */
  const workIn = async (w: TaskWorktree) => {
    if (!(await exists(w.path))) return { commits: 0, uncommitted: 0 };
    const commits =
      (await s.git.commitsSince(w.path, w.baseSha ?? w.baseRef)) ?? 0;
    const summary = await s.git.summary(w.path, w.baseRef).catch(() => null);
    return { commits, uncommitted: summary?.files.length ?? 0 };
  };

  /** Takes one repo out of a task folder: its tabs, its worktree and (when asked) its branch. */
  const removeRepo = async (
    taskId: string,
    repoId: string,
    o: { force: boolean; deleteBranch: boolean },
  ) => {
    const task = taskById(taskId);
    if (!isFolderTask(task)) throw new Error('This task has no task folder');
    if (task.status !== 'ready')
      throw new Error(
        `Cannot change the repos of a task that is ${task.status}`,
      );
    const w = worktreeOf(task, repoId);
    if (worktreesOf(task).length <= 1)
      throw new Error(
        'A task keeps at least one repo. Finish the task to remove its last one.',
      );
    if (repoChanging.has(taskId))
      throw new Error('Another repo of this task is being added or removed');
    if (inFlight.has(taskId)) throw new Error('Task is busy');
    repoChanging.add(taskId);
    try {
      // A repo whose setup failed has no work of the user's yet; its copied files may go.
      if (!o.force && w.status === 'ready') {
        const work = await workIn(w);
        if (work.commits > 0 || work.uncommitted > 0)
          throw new Error(
            `${REPO_HAS_WORK}${plural(work.commits, 'commit')}, ${plural(work.uncommitted, 'uncommitted change')}`,
          );
      }
      const repo = s.repos.get(repoId);
      // A terminal in the folder blocks its removal on Windows, and so does the Docs watcher.
      for (const d of task.terminals)
        if (d.repoId === repoId) await s.terminals.kill(d.id);
      docsWatcher.stopTask(taskId);
      if (await exists(w.path))
        await s.git.worktreeRemove(repo.path, w.path, true);
      await s.git.worktreePrune(repo.path);
      if (o.deleteBranch && (await s.git.branchExists(repo.path, w.branch)))
        await s.git.deleteBranch(repo.path, w.branch);
      setupStates.delete(setupKey(taskId, repoId));
      await mutateTask(taskId, (t) => {
        t.worktrees = (t.worktrees ?? []).filter((x) => x.repoId !== repoId);
        t.terminals = t.terminals.filter((d) => d.repoId !== repoId);
        const next = t.worktrees[0];
        if (t.repoId === repoId && next) {
          t.repoId = next.repoId;
          t.baseRef = next.baseRef;
        }
      });
      await writeTaskFiles(taskId);
      tellClaude(
        taskId,
        `repo ${repoName(repoId)} was removed from this task. CLAUDE.md lists the task's repos.`,
      );
      tel.event('task.repoRemoved', {
        forced: o.force,
        deleteBranch: o.deleteBranch,
      });
    } finally {
      repoChanging.delete(taskId);
    }
  };

  /** Once an added repo is set up: tell Claude, and finish a Move by removing the repo it replaces. */
  const afterRepoAdded = async (taskId: string, repoId: string) => {
    const key = setupKey(taskId, repoId);
    const replaces = pendingReplace.get(key) ?? null;
    pendingReplace.delete(key);
    const w = worktreeOf(taskById(taskId), repoId);
    tellClaude(
      taskId,
      `repo ${repoName(repoId)} was added to this task in ./${w.dir} (branch ${w.branch}). CLAUDE.md lists the task's repos.`,
    );
    if (!replaces) return;
    try {
      await removeRepo(taskId, replaces, { force: false, deleteBranch: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      s.broadcast('notice', {
        level: 'warn',
        message: message.startsWith(REPO_HAS_WORK)
          ? `${repoName(replaces)} was kept: it has work (${message.slice(REPO_HAS_WORK.length)}). Remove it on the Repos page.`
          : `${repoName(replaces)} was kept: ${message}`,
      });
    }
  };

  const docsWatcher =
    s.docsWatcher ??
    new DocsWatcher(
      (taskId, paths) => s.broadcast('docs:changed', { taskId, paths }),
      undefined,
      (taskId) => s.broadcast('docs:watchStopped', { taskId }),
    );

  return {
    ...createDocsHandlers({
      taskById,
      git: s.git,
      editorGoto: (wt, f, l, c) => s.platform.editorGotoCommand(wt, f, l, c),
      launch: s.launch,
      openExternal: s.openExternal,
      revealFile: s.revealFile ?? (() => undefined),
      watcher: docsWatcher,
      event: (n, p) => tel.event(n, p),
    }),
    'repos:list': async () => s.repos.list(),
    'repos:add': async (folder) => {
      const repo = await s.repos.add(folder);
      s.broadcast('repos:changed', s.repos.list());
      tel.event('repo.added', { repos: s.repos.list().length });
      return repo;
    },
    'repos:remove': async (id) => {
      await s.repos.remove(id);
      s.broadcast('repos:changed', s.repos.list());
      tel.event('repo.removed');
    },
    'repos:refresh': async (id) => {
      const repo = await s.repos.refresh(id);
      s.broadcast('repos:changed', s.repos.list());
      return repo;
    },
    'repos:pickFolder': () => s.pickFolder(),
    'repos:config': async (repoId) => {
      const repo = s.repos.get(repoId);
      return {
        config: await s.loadConfig(repo.path),
        worktreeRoot: worktreeRoot(repo.path),
      };
    },

    'tasks:list': listTasks,
    'tasks:create': async (input) => {
      const repo = s.repos.get(input.repoId);
      const branch = input.branch.trim();
      if (!(await s.git.validBranchName(repo.path, branch)))
        throw new Error(`"${branch}" is not a valid branch name`);
      if (await s.git.branchExists(repo.path, branch))
        throw new Error(`Branch ${branch} already exists in ${repo.name}`);
      if (!input.workItem && input.name.trim().length === 0)
        throw new Error('Give the task a name or a work item');
      if (input.workItem && input.workItem.title.trim().length === 0)
        throw new Error('Give the work item a title');
      // New tasks get a task folder with the repo's worktree inside; older tasks were their worktree.
      const layout = s.newTaskLayout ?? 'folder';
      const slug =
        layout === 'folder'
          ? folderName(input.workItem, input.name)
          : taskSlug(input.workItem, input.name);
      const worktreePath =
        layout === 'folder'
          ? path.join(
              s.settings.get().tasksFolder || defaultTasksFolder(),
              slug,
            )
          : path.join(worktreeRoot(repo.path), slug);
      if (await exists(worktreePath))
        throw new Error(`Folder ${worktreePath} already exists`);
      const dir = repoDir(repo.name, []);
      const keys = [`${repo.id}:${branch}`, `${repo.id}:${worktreePath}`];
      if (
        keys.some((k) => creating.has(k)) ||
        s.store.state.tasks.some(
          (t) =>
            t.repoId === repo.id &&
            t.status !== 'done' &&
            (t.branch === branch || t.worktreePath === worktreePath),
        )
      )
        throw new Error(`Branch ${branch} is already being created`);
      for (const k of keys) creating.add(k);
      const task: Task = {
        id: randomUUID(),
        repoId: repo.id,
        name: input.name.trim(),
        workItem: input.workItem,
        slug,
        branch,
        worktreePath,
        baseRef: input.baseRef,
        baseSha: null,
        status: 'setting-up',
        setup: {
          copy: input.copy,
          commands: input.commands,
          startClaude: input.startClaude,
          openShell: input.openShell,
          openCopilot: input.openCopilot ?? false,
        },
        terminals: [],
        createdAt: new Date().toISOString(),
        finishedAt: null,
        usageSyncedAt: null,
        usageSyncError: null,
        usageCommentId: null,
        summary: null,
        pullRequest: null,
        closedTerminals: [],
        reopen: null,
        ...(layout === 'folder'
          ? {
              folder: worktreePath,
              worktrees: [
                {
                  repoId: repo.id,
                  dir,
                  path: path.join(worktreePath, dir),
                  branch,
                  baseRef: input.baseRef,
                  baseSha: null,
                  status: 'setting-up' as const,
                  copy: input.copy,
                  commands: input.commands,
                  summary: null,
                  pullRequest: null,
                  reopen: null,
                },
              ],
            }
          : {}),
      };
      inFlight.add(task.id);
      try {
        await s.store.update((st) => {
          st.tasks.push(task);
        });
      } catch (e) {
        release(task.id);
        throw e;
      } finally {
        for (const k of keys) creating.delete(k);
      }
      startSetupInBackground(task.id);
      tel.event('task.created', {
        workItem: input.workItem !== null && input.workItem !== undefined,
        copy: input.copy,
        startClaude: input.startClaude,
        openShell: input.openShell,
        openCopilot: input.openCopilot ?? false,
        commands: input.commands.length,
      });
      await tasksChanged();
      return task;
    },
    'tasks:setupState': async (taskId, repoId) =>
      setupStates.get(setupKey(taskId, repoId)) ?? null,
    'tasks:addRepo': async (taskId, input) => {
      const task = taskById(taskId);
      if (!isFolderTask(task)) throw new Error('This task has no task folder');
      if (task.status !== 'ready')
        throw new Error(`Cannot add a repo to a task that is ${task.status}`);
      const repo = s.repos.get(input.repoId);
      const current = worktreesOf(task);
      if (current.some((w) => w.repoId === repo.id))
        throw new Error(`${repo.name} is already in this task`);
      const taskConnection =
        s.repos.list().find((r) => r.id === task.repoId)?.connectionId ?? null;
      if (repo.connectionId !== null && repo.connectionId !== taskConnection)
        throw new Error(
          `${repo.name} is linked to another Azure DevOps project than this task's work item`,
        );
      if (input.replaces) worktreeOf(task, input.replaces);
      if (repoChanging.has(taskId))
        throw new Error('Another repo of this task is being added or removed');
      if (inFlight.has(taskId)) throw new Error('Task is busy');
      repoChanging.add(taskId);
      let started = false;
      try {
        const branch = task.branch;
        if (!(await s.git.validBranchName(repo.path, branch)))
          throw new Error(`"${branch}" is not a valid branch name`);
        if (await s.git.branchExists(repo.path, branch))
          throw new Error(`Branch ${branch} already exists in ${repo.name}`);
        const dir = repoDir(
          repo.name,
          current.map((w) => w.dir),
        );
        const wtPath = path.join(task.worktreePath, dir);
        if (await exists(wtPath))
          throw new Error(`Folder ${wtPath} already exists`);
        await mutateTask(taskId, (t) => {
          t.worktrees = [
            ...(t.worktrees ?? []),
            {
              repoId: repo.id,
              dir,
              path: wtPath,
              branch,
              baseRef: input.baseRef,
              baseSha: null,
              status: 'setting-up',
              copy: input.copy,
              commands: input.commands,
              summary: null,
              pullRequest: null,
              reopen: null,
            },
          ];
        });
        if (input.replaces)
          pendingReplace.set(setupKey(taskId, repo.id), input.replaces);
        started = true;
        startSetupInBackground(taskId, undefined, repo.id);
      } finally {
        if (!started) repoChanging.delete(taskId);
      }
    },
    'tasks:retryRepoSetup': async (taskId, repoId) => {
      const w = worktreeOf(taskById(taskId), repoId);
      if (w.status !== 'setup-failed')
        throw new Error(`Cannot retry the setup of a repo that is ${w.status}`);
      if (repoChanging.has(taskId))
        throw new Error('Another repo of this task is being added or removed');
      repoChanging.add(taskId);
      const from = setupStates.get(setupKey(taskId, repoId))?.failedStep ?? 0;
      try {
        await mutateTask(taskId, (t) =>
          patchWorktree(t, repoId, { status: 'setting-up' }),
        );
      } catch (e) {
        repoChanging.delete(taskId);
        throw e;
      }
      startSetupInBackground(taskId, from, repoId);
    },
    'tasks:removeRepo': async (taskId, repoId, options) =>
      removeRepo(taskId, repoId, options),
    'tasks:retrySetup': async (taskId) => {
      claim(taskId, ['setup-failed'], 'retry the setup of');
      const from = setupStates.get(taskId)?.failedStep ?? 0;
      try {
        await patchTask(taskId, { status: 'setting-up' });
      } catch (e) {
        release(taskId);
        throw e;
      }
      startSetupInBackground(taskId, from);
      tel.event('setup.retried');
    },
    'tasks:cancelSetup': async (taskId) => {
      claim(taskId, ['setup-failed'], 'cancel the setup of');
      try {
        const task = taskById(taskId);
        // Windows will not remove a folder that a running process has as its cwd.
        docsWatcher.stopTask(taskId);
        await s.terminals.killAllForTask(taskId);
        for (const w of worktreesOf(task)) {
          const repo = s.repos.get(w.repoId);
          if (await exists(w.path))
            await s.git.worktreeRemove(repo.path, w.path, true);
          await s.git.worktreePrune(repo.path);
        }
        if (isFolderTask(task)) await removeTaskFolder(task.worktreePath);
        if (task.reopen) {
          // A failed reopen goes back to Done; the task, its branches and its history stay.
          setupStates.delete(taskId);
          await mutateTask(taskId, (t) => {
            t.status = 'done';
            t.reopen = null;
            t.terminals = [];
            for (const w of t.worktrees ?? []) w.reopen = null;
          });
          tel.event('task.reopenCancelled');
          return;
        }
        for (const w of worktreesOf(task)) {
          const repo = s.repos.get(w.repoId);
          if (await s.git.branchExists(repo.path, w.branch))
            await s.git.deleteBranch(repo.path, w.branch);
        }
        setupStates.delete(taskId);
        await s.store.update((st) => {
          st.tasks = st.tasks.filter((t) => t.id !== taskId);
        });
        await tasksChanged();
        tel.event('setup.cancelled');
      } finally {
        release(taskId);
      }
    },
    'tasks:gitSummary': async (taskId) => {
      const task = taskById(taskId);
      if (!isFolderTask(task))
        return s.git.summary(task.worktreePath, task.baseRef);
      const ready = worktreesOf(task).filter((w) => w.status === 'ready');
      const each = await Promise.all(
        ready.map(async (w) => ({
          w,
          g: await s.git.summary(w.path, w.baseRef).catch(() => null),
        })),
      );
      const known = each.filter(
        (x): x is { w: TaskWorktree; g: GitSummary } => x.g !== null,
      );
      return {
        branch: task.branch,
        ahead: known.reduce((n, x) => n + x.g.ahead, 0),
        behind: known.reduce((n, x) => n + x.g.behind, 0),
        hasUpstream: known.length > 0 && known.every((x) => x.g.hasUpstream),
        files: known.flatMap((x) =>
          x.g.files.map((f) => ({ ...f, path: `${x.w.dir}/${f.path}` })),
        ),
        repos: known.map((x) => ({
          repoId: x.w.repoId,
          dir: x.w.dir,
          ahead: x.g.ahead,
          behind: x.g.behind,
          files: x.g.files.length,
        })),
      };
    },
    'tasks:finishChecks': async (taskId) => {
      const task = taskById(taskId);
      const repos: RepoFinishCheck[] = await Promise.all(
        worktreesOf(task).map(async (w) => {
          const summary = await s.git.summary(w.path, w.baseRef);
          return {
            repoId: w.repoId,
            dir: w.dir,
            branch: w.branch,
            uncommitted: summary.files,
            unpushed: summary.ahead,
            commits: await s.git.commitsSince(w.path, w.baseSha ?? w.baseRef),
          };
        }),
      );
      const prefixed = (r: RepoFinishCheck): GitFile[] =>
        isFolderTask(task)
          ? r.uncommitted.map((f) => ({ ...f, path: `${r.dir}/${f.path}` }))
          : r.uncommitted;
      return {
        uncommitted: repos.flatMap(prefixed),
        unpushed: repos.reduce((n, r) => n + r.unpushed, 0),
        runningTerminals: s.terminals.runningCount(taskId),
        repos,
      };
    },
    'tasks:reopen': async (taskId) => {
      claim(taskId, ['done'], 'reopen');
      let setup = false;
      try {
        const task = taskById(taskId);
        const folder = isFolderTask(task);
        const state = await Promise.all(
          worktreesOf(task).map(async (w) => {
            const repo = s.repos.get(w.repoId);
            return {
              w,
              repo,
              hasBranch: await s.git.branchExists(repo.path, w.branch),
              present: await exists(w.path),
            };
          }),
        );
        for (const x of state)
          if (x.present && !x.hasBranch)
            throw new Error(
              `${x.w.path} exists but branch ${x.w.branch} is gone`,
            );
        if (state.every((x) => x.present)) {
          // The worktrees were kept: back to ready with the tabs it had.
          const defs =
            task.terminals.length > 0
              ? task.terminals
              : restoredTerminals(task);
          await patchTask(taskId, {
            status: 'ready',
            finishedAt: null,
            terminals: defs,
            closedTerminals: [],
          });
          startRestored(taskById(taskId), defs);
          tel.event('task.reopened', { from: 'folder' });
          return { setup: false };
        }
        const froms: { repoId: string; from: string | null }[] = [];
        let via = 'branch';
        for (const { w, repo, hasBranch } of state) {
          let from: string | null = null;
          if (!hasBranch) {
            const remote = `origin/${w.branch}`;
            await s.git.fetch(repo.path, remote).catch(() => false);
            const head = w.summary?.commits[0]?.sha;
            if (await s.git.commitExists(repo.path, `refs/remotes/${remote}`)) {
              from = remote;
              via = 'origin';
            } else if (head && (await s.git.commitExists(repo.path, head))) {
              from = head;
              via = 'commit';
            } else if (w.summary && w.summary.commitCount === 0) {
              from = w.baseSha ?? w.baseRef;
              via = 'base';
            } else
              throw new Error(
                `Branch ${w.branch}${folder ? ` of ${w.dir}` : ''} cannot be restored: it was deleted and is not on origin`,
              );
          }
          froms.push({ repoId: w.repoId, from });
        }
        await mutateTask(taskId, (t) => {
          t.status = 'setting-up';
          t.terminals = [];
          // A task folder marks the reopen on the task and keeps each repo's starting point on its worktree.
          t.reopen = { from: folder ? null : (froms[0]?.from ?? null) };
          if (folder)
            for (const f of froms)
              patchWorktree(t, f.repoId, { reopen: { from: f.from } });
        });
        setup = true;
        startSetupInBackground(taskId);
        tel.event('task.reopened', { from: via });
        return { setup: true };
      } finally {
        // The setup releases the task when it ends.
        if (!setup) release(taskId);
      }
    },
    'tasks:finish': async (taskId, options) => {
      if (repoChanging.has(taskId))
        throw new Error(
          'Wait until the repo being added or removed is done, then finish',
        );
      claim(taskId, ['ready'], 'finish');
      try {
        const task = taskById(taskId);
        const folder = isFolderTask(task);
        const worktrees = worktreesOf(task);
        await patchTask(taskId, { status: 'finishing' });
        // Record what each branch did while its worktree still exists; a summary must never block Finish.
        const summaries = new Map<string, TaskSummary | null>();
        for (const w of worktrees)
          summaries.set(
            w.repoId,
            (await exists(w.path))
              ? await s.git
                  .finishSummary(w.path, {
                    baseRef: w.baseRef,
                    baseSha: w.baseSha,
                    branch: w.branch,
                  })
                  .catch(() => null)
              : null,
          );
        // Older tasks: the one repo. A task folder: every repo with commits, unless the repos are named.
        const prRepos =
          options.pullRequestRepos ??
          (!options.createPullRequest
            ? []
            : folder
              ? worktrees
                  .filter(
                    (w) => (summaries.get(w.repoId)?.commitCount ?? 0) > 0,
                  )
                  .map((w) => w.repoId)
              : [task.repoId]);
        // The home repo first: its PR carries the cost line, so the amount is never counted twice.
        const ordered = worktrees
          .filter((w) => prRepos.includes(w.repoId))
          .sort((a, b) =>
            a.repoId === task.repoId ? -1 : b.repoId === task.repoId ? 1 : 0,
          );
        const opened: string[] = [];
        // Push and open the PRs before any cleanup: a failure leaves the task ready with its worktrees.
        // PRs made before a failure stay; Retry links them (an active PR for the branch) instead of making more.
        for (const [i, w] of ordered.entries()) {
          try {
            const c = await prContext(task, w.repoId);
            if (
              !c.availability.available ||
              !c.availability.target ||
              !c.connection
            )
              throw new Error(
                c.availability.reason ?? 'pull requests are not available',
              );
            const connection = c.connection;
            const { project, repo: azureRepo } = c.availability.target;
            await s.git.push(w.path, 'origin', w.branch);
            // The summary was taken before this push; the Done page would otherwise say "local only".
            const summary = summaries.get(w.repoId) ?? null;
            if (summary)
              summaries.set(w.repoId, {
                ...summary,
                pushed: true,
                upstream: `origin/${w.branch}`,
              });
            const client = s.ado.client(connection.id);
            const repositoryId = await client.repositoryId(project, azureRepo);
            const existing = await client.findActivePullRequest(
              project,
              repositoryId,
              w.branch,
            );
            const raw =
              existing ??
              (await client.createPullRequest(project, repositoryId, {
                source: w.branch,
                target: c.target,
                title: prTitle(task),
                description: prDescription({
                  heading: task.workItem
                    ? `${task.workItem.type} ${task.workItem.id}: ${task.workItem.title}`
                    : task.name,
                  commits: summary?.commits ?? [],
                  commitCount: summary?.commitCount ?? 0,
                  costLine: i === 0 ? costLineFor(taskId) : null,
                  otherRepos:
                    folder && worktrees.length > 1
                      ? worktrees
                          .filter((x) => x.repoId !== w.repoId)
                          .map((x) => `${x.dir} (\`${x.branch}\`)`)
                      : [],
                }),
                workItemId: task.workItem ? Number(task.workItem.id) : null,
              }));
            const pullRequest: PullRequestRef = {
              id: raw.pullRequestId,
              url: prWebUrl(
                connection.organizationUrl,
                project,
                azureRepo,
                raw.pullRequestId,
              ),
              repositoryId,
              project,
              repo: azureRepo,
              status: raw.status,
              isDraft: raw.isDraft,
            };
            await mutateTask(taskId, (t) =>
              patchWorktree(t, w.repoId, { pullRequest }),
            );
            opened.push(pullRequest.url);
            tel.event(existing ? 'pr.linked' : 'pr.created');
          } catch (e) {
            await patchTask(taskId, { status: 'ready' });
            const message = e instanceof Error ? e.message : String(e);
            tel.event('pr.failed', {
              kind: e instanceof AdoError ? e.kind : 'git',
            });
            for (const url of opened)
              void s.openExternal(url).catch(() => undefined);
            throw new Error(
              `Pull request not created: ${folder ? `${w.dir}: ` : ''}${message}`,
            );
          }
        }
        for (const url of opened)
          void s.openExternal(url).catch(() => undefined);
        // A terminal running in the folder blocks its removal on Windows (and a terminal without its
        // folder is useless), so removing the worktree closes the terminals even when that was unticked.
        const killTerminals = options.closeTerminals || options.removeWorktree;
        try {
          if (killTerminals) {
            docsWatcher.stopTask(taskId);
            await s.terminals.killAllForTask(taskId);
            await patchTask(taskId, {
              closedTerminals: taskById(taskId).terminals,
              terminals: [],
            });
          }
          for (const w of worktrees) {
            const repo = s.repos.get(w.repoId);
            if (options.removeWorktree && (await exists(w.path)))
              await s.git.worktreeRemove(repo.path, w.path, true);
            if (options.deleteBranch) {
              // A deleted folder leaves a stale registration that blocks branch deletion.
              // A folder that still exists keeps the refusal, which protects uncommitted work.
              await s.git.worktreePrune(repo.path);
              await s.git.deleteBranch(repo.path, w.branch);
            }
          }
          if (folder && options.removeWorktree)
            await removeTaskFolder(task.worktreePath);
        } catch (e) {
          await patchTask(taskId, { status: 'ready' });
          throw e;
        }
        await mutateTask(taskId, (t) => {
          t.status = 'done';
          t.finishedAt = new Date().toISOString();
          for (const w of worktrees)
            patchWorktree(t, w.repoId, {
              summary: summaries.get(w.repoId) ?? null,
            });
        });
        tel.event(
          'task.finished',
          {
            removeWorktree: options.removeWorktree,
            deleteBranch: options.deleteBranch,
            closeTerminals: options.closeTerminals,
            syncUsage: options.syncUsage && writeCost(),
            workItem: task.workItem !== null && task.workItem !== undefined,
          },
          {
            ageHours: (Date.now() - Date.parse(task.createdAt)) / 3_600_000,
            repos: worktrees.length,
            pullRequests: ordered.length,
          },
        );
        if (options.syncUsage && writeCost()) {
          try {
            if (killTerminals && s.finishFlushMs > 0)
              await new Promise((r) => setTimeout(r, s.finishFlushMs));
            await s.copilot.poll();
            const result = await usageSync.syncTask(taskId, {
              comment: true,
              refreshFields: true,
            });
            tel.event('usage.synced', { ok: result.ok, onFinish: true });
            if (!result.ok)
              s.broadcast('notice', {
                level: 'warn',
                message: `Task finished, but the AI usage could not be written to the work item: ${result.error}. Use Sync now on the Usage screen to retry.`,
              });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            s.broadcast('notice', {
              level: 'warn',
              message: `Task finished, but the AI usage could not be written to the work item: ${message}. Use Sync now on the Usage screen to retry.`,
            });
          }
        }
      } finally {
        release(taskId);
      }
    },
    'tasks:openInEditor': async (taskId) => {
      const task = taskById(taskId);
      await s.launch(s.platform.editorCommand(task.worktreePath));
      tel.event('editor.opened');
    },

    'terminals:open': async (taskId, def) => {
      claim(taskId, ['ready'], 'open a terminal in');
      let full: TerminalDef;
      try {
        if (def.repoId) {
          const task = taskById(taskId);
          if (
            !isFolderTask(task) ||
            !worktreesOf(task).some(
              (w) => w.repoId === def.repoId && w.status === 'ready',
            )
          )
            throw new Error('That repo is not in this task');
        }
        full = {
          id: randomUUID(),
          ...def,
          // A shell tab is named after the platform's shell (PowerShell, zsh), like the one setup opens.
          ...(def.kind === 'shell' ? { label: s.platform.shellLabel } : {}),
          ...(def.kind === 'claude' ? { sessionId: randomUUID() } : {}),
        };
        spawnTerminal(taskById(taskId), full);
      } finally {
        release(taskId);
      }
      await updateTerminals(taskId, (list) => [...list, full]);
      tel.event('terminal.opened', { kind: full.kind, initial: false });
      return full;
    },
    'terminals:write': async (id, data) => s.terminals.write(id, data),
    'terminals:resize': async (id, cols, rows) =>
      s.terminals.resize(id, cols, rows),
    'terminals:kill': async (id) => {
      s.terminals.kill(id);
      const owner = s.store.state.tasks.find((t) =>
        t.terminals.some((x) => x.id === id),
      );
      const def = owner?.terminals.find((x) => x.id === id);
      if (owner)
        await updateTerminals(owner.id, (list) =>
          list.filter((x) => x.id !== id),
        );
      if (def) tel.event('terminal.closed', { kind: def.kind });
    },
    'terminals:restart': async (id) => {
      const owner = s.store.state.tasks.find((t) =>
        t.terminals.some((x) => x.id === id),
      );
      const def = owner?.terminals.find((x) => x.id === id);
      const known = s.terminals.has(id);
      // Claude Code resumes its conversation instead of starting a new one.
      if (known && def?.kind !== 'claude') {
        s.terminals.restart(id);
        return;
      }
      if (!owner || !def) throw new Error(`Unknown terminal ${id}`);
      // After an app relaunch the manager is empty while the task still lists its terminals.
      if (!known && owner.status !== 'ready')
        throw new Error(
          `Cannot restart a terminal of a task that is ${owner.status}`,
        );
      await s.terminals.kill(id);
      spawnTerminal(owner, def, def.kind === 'claude');
      tel.event('terminal.restarted', {
        kind: def.kind,
        afterRelaunch: !known,
      });
    },
    'terminals:buffer': async (id) => s.terminals.buffer(id),
    'terminals:isRunning': async (id) => s.terminals.isRunning(id),
    'connections:list': async () => s.connections.list(),
    'connections:save': async (input) => {
      // Verify with a throwaway client before anything is written, so a bad token never lands on disk.
      s.connections.assertCanSave(input);
      const organizationUrl = s.connections.normalizeUrl(input.organizationUrl);
      const probe = new AdoClient(organizationUrl, async () =>
        input.pat.trim(),
      );
      const { user, uniqueName } = await probe.verify(input.project.trim());
      const saved = await s.connections.save(input);
      s.ado.invalidate(saved.id);
      dropTypes(saved.id);
      // The unique name is what "assign to me" writes on start; without it a new connection never assigns.
      const verified = await s.connections.setStatus(
        saved.id,
        'ok',
        user,
        uniqueName,
      );
      connectionsChanged();
      tel.event('connection.saved', {
        connections: s.connections.list().length,
      });
      return verified;
    },
    'connections:remove': async (id) => {
      s.connections.get(id);
      for (const r of s.repos.list())
        if (r.connectionId === id) await s.repos.setConnection(r.id, null);
      await s.connections.remove(id);
      s.ado.invalidate(id);
      dropTypes(id);
      connectionsChanged();
      s.broadcast('repos:changed', s.repos.list());
      tel.event('connection.removed');
    },
    'connections:verify': async (id) => verifyConnection(id),
    'repos:setConnection': async (repoId, connectionId) => {
      if (connectionId !== null) s.connections.get(connectionId);
      const repo = await s.repos.setConnection(repoId, connectionId);
      s.broadcast('repos:changed', s.repos.list());
      tel.event('repo.connectionLinked', { linked: connectionId !== null });
      return repo;
    },
    'repos:setWorkItemOnStart': async (repoId, settings) => {
      const repo = await s.repos.setWorkItemOnStart(repoId, settings);
      s.broadcast('repos:changed', s.repos.list());
      return repo;
    },
    'tasks:prAvailability': async (taskId) => {
      const task = taskById(taskId);
      const of = async (repoId: string) => {
        const c = await prContext(task, repoId);
        return {
          available: c.availability.available,
          reason: c.availability.reason,
          target: c.availability.available ? c.target : null,
        };
      };
      if (!isFolderTask(task)) return of(task.repoId);
      const repos = await Promise.all(
        worktreesOf(task).map(async (w) => ({
          repoId: w.repoId,
          dir: w.dir,
          ...(await of(w.repoId).catch((e: Error) => ({
            available: false,
            reason: e.message,
            target: null,
          }))),
        })),
      );
      const home = repos.find((r) => r.repoId === task.repoId) ?? repos[0];
      return {
        available: home?.available ?? false,
        reason: home?.reason ?? null,
        target: home?.target ?? null,
        repos,
      };
    },
    'tasks:prStatus': async (taskId, repoId) => {
      const task = taskById(taskId);
      const id = repoId ?? task.repoId;
      const pr = worktreesOf(task).find((w) => w.repoId === id)?.pullRequest;
      if (!pr) return null;
      // A PR goes through the task's connection: every repo of a task folder shares it.
      const connectionId =
        s.repos.list().find((r) => r.id === id)?.connectionId ??
        s.repos.list().find((r) => r.id === task.repoId)?.connectionId ??
        null;
      if (!connectionId) return pr;
      try {
        const raw = await s.ado
          .client(connectionId)
          .pullRequest(pr.project, pr.repositoryId, pr.id);
        const next = { ...pr, status: raw.status, isDraft: raw.isDraft };
        await mutateTask(taskId, (t) =>
          patchWorktree(t, id, { pullRequest: next }),
        );
        return next;
      } catch {
        return pr;
      }
    },
    'workItems:currentIteration': async (connectionId) => {
      const c = s.connections.get(connectionId);
      return withConnection(connectionId, () =>
        s.ado.client(connectionId).currentIteration(c.project),
      );
    },
    'workItems:search': async (connectionId, search) => {
      const c = s.connections.get(connectionId);
      tel.event('workItems.search', {
        scope: search.scope,
        hasText: search.text.trim().length > 0,
      });
      return withConnection(connectionId, async () => {
        const client = s.ado.client(connectionId);
        const iteration =
          search.scope === 'sprint'
            ? await client.currentIteration(c.project)
            : null;
        if (search.scope === 'sprint' && !iteration) return [];
        return client.searchWorkItems({
          project: c.project,
          scope: search.scope,
          text: search.text,
          iterationPath: iteration?.path ?? null,
        });
      });
    },
    'workItems:sprint': async (connectionId) => {
      const c = s.connections.get(connectionId);
      return withConnection(connectionId, () =>
        s.ado.client(connectionId).sprint(c.project),
      );
    },
    'workItems:types': async (connectionId) => {
      const c = s.connections.get(connectionId);
      let hit = typesCache.get(connectionId);
      if (!hit) {
        const client = s.ado.client(connectionId);
        hit = withConnection(connectionId, () =>
          client.workItemTypes(c.project),
        ).then((types) =>
          Promise.all(
            types.map(async ({ iconUrl, ...t }) => ({
              ...t,
              icon: iconUrl ? await client.iconDataUrl(iconUrl) : null,
            })),
          ),
        );
        typesCache.set(connectionId, hit);
        hit.catch(() => {
          if (typesCache.get(connectionId) === hit) dropTypes(connectionId);
        });
      }
      return hit;
    },
    'workItems:get': async (connectionId, id) => {
      const c = s.connections.get(connectionId);
      const n = Number(id);
      if (!Number.isInteger(n) || n < 1) return null;
      const [item] = await withConnection(connectionId, () =>
        s.ado.client(connectionId).workItems(c.project, [n]),
      );
      if (!item) return null;
      const { remainingWork: _, ...summary } = item;
      return summary;
    },
    'shell:openExternal': async (url) => {
      if (!allowedExternal(url))
        throw new Error(`Opening ${url} is not allowed`);
      await s.openExternal(url);
    },

    'usage:task': async (taskId) => s.usage.summarize(taskId),
    'usage:setBillable': async (taskId, sessionId, billable) => {
      await s.usage.setBillable(taskId, sessionId, billable);
      return s.usage.summarize(taskId);
    },
    'usage:sync': async (taskId) => {
      if (!writeCost())
        throw new Error(
          'Writing AI cost to Azure DevOps is off. Turn it on in Settings, AI cost and invoicing.',
        );
      const result = await usageSync.syncTask(taskId, {
        refreshFields: true,
        // A done task still owes its one usage comment if the write on finish failed.
        comment: taskById(taskId).status === 'done',
      });
      tel.event('usage.synced', { ok: result.ok, onFinish: false });
      return result;
    },
    'usage:exportCsv': async (taskId) => {
      tel.event('usage.exportCsv');
      return usageCsv(
        s.usage.records(taskId),
        (sessionId) => s.usage.isBillable(taskId, sessionId),
        OFFICIAL_USD_TO_EUR,
      );
    },
    'usage:fieldsStatus': async (connectionId) =>
      usageSync.fieldsStatus(
        connectionId,
        s.connections.get(connectionId).project,
      ),
    'usage:receiverStatus': async () => receiverStatus(),
    'rates:list': async () => ({
      rates: OFFICIAL_RATES,
      officialAsOf: OFFICIAL_RATES_AS_OF,
    }),
    'update:status': async () => s.update?.pending() ?? null,
    'update:install': async () => {
      if (!s.update?.pending())
        throw new Error('No update is ready to install');
      // The quit flushes telemetry (will-quit) while Squirrel's Update.exe waits to start the new version.
      tel.event('update.restart');
      if (!s.update.install()) throw new Error('No update is ready to install');
    },
    'app:info': async () => ({
      version: s.appVersion,
      windowsBuild: s.windowsBuild ?? null,
    }),
    'settings:get': async () => s.settings.get(),
    'settings:save': async (next) => {
      const before = s.settings.get();
      const saved = await s.settings.save(next);
      const changed = changedKeys(before, saved);
      // Turning telemetry off is the one change that is not reported.
      if (changed.length > 0 && saved.sendTelemetry)
        tel.event('settings.changed', { keys: changed.join(',') });
      if (
        saved.receiverPort !== before.receiverPort ||
        !s.receiver.status.listening
      ) {
        const st = await s.receiver.start(saved.receiverPort);
        s.broadcast('usage:receiverStatus', receiverStatus());
        if (!st.listening)
          s.broadcast('notice', {
            level: 'warn',
            message: `AI usage capture is off: ${st.error}. Pick another port in Settings.`,
          });
        else if (saved.receiverPort !== before.receiverPort)
          s.broadcast('notice', {
            level: 'info',
            message: `AI usage is now received on port ${saved.receiverPort}. Terminals started before this change keep using the old port until you restart them.`,
          });
      }
      s.broadcast('usage:changed', { taskId: '*' });
      return saved;
    },
  };
}
