import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Events, Handlers } from '../../shared/ipc';
import { claudePrompt, renderTaskMd, taskSlug } from '../../shared/naming';
import type {
  Connection,
  MiacConfig,
  SetupEvent,
  SetupState,
  Task,
  TaskStatus,
  TaskView,
  TerminalDef,
} from '../../shared/types';
import { worktreeRoot } from '../paths';
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
import type { GitClient } from '../services/GitClient';
import type { RepoRegistry } from '../services/RepoRegistry';
import {
  planSteps,
  type SetupPlan,
  type SetupRunner,
} from '../services/SetupRunner';
import type { TaskStore } from '../services/TaskStore';
import type { TerminalManager } from '../services/TerminalManager';
import type { CopilotFileTailer } from '../usage/CopilotFileTailer';
import { usageCsv } from '../usage/csv';
import type { SettingsStore } from '../usage/SettingsStore';
import { telemetryEnv } from '../usage/telemetryEnv';
import type { UsageReceiver } from '../usage/UsageReceiver';
import type { UsageStore } from '../usage/UsageStore';
import { UsageSync } from '../usage/UsageSync';

export type Services = {
  store: TaskStore;
  git: GitClient;
  platform: Platform;
  repos: RepoRegistry;
  connections: ConnectionStore;
  ado: AdoRegistry;
  openExternal: (url: string) => Promise<void>;
  terminals: TerminalManager;
  runner: SetupRunner;
  loadConfig: (repoPath: string) => Promise<MiacConfig>;
  pickFolder: () => Promise<string | null>;
  launch: (cmd: Command) => Promise<void>;
  broadcast: <K extends keyof Events>(event: K, payload: Events[K]) => void;
  usage: UsageStore;
  settings: SettingsStore;
  receiver: Pick<UsageReceiver, 'start' | 'status'>;
  copilot: Pick<CopilotFileTailer, 'stats' | 'poll'>;
  usageDir: string;
  /** Registers a function to run every hour (main uses setInterval; tests capture it). */
  onHourly: (fn: () => void) => void;
  /** How long Finish waits after closing terminals so the last telemetry batch arrives (main 2500, tests 0). */
  finishFlushMs: number;
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
  const connectionsChanged = () =>
    s.broadcast('connections:changed', s.connections.list());

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
    const { user } = await withConnection(connectionId, () =>
      s.ado.client(connectionId).verify(c.project),
    );
    const updated = await s.connections.setStatus(connectionId, 'ok', user);
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

  const setupStates = new Map<string, SetupState>();
  const inFlight = new Set<string>();

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
    if (s.settings.get().hourlySync)
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

  const terminalCommand = (task: Task, def: TerminalDef): Command => {
    if (def.kind === 'claude')
      return s.platform.claudeCommand(claudePrompt(task));
    if (def.kind === 'run' && def.command)
      return s.platform.runCommand(def.command);
    if (def.kind === 'copilot') return s.platform.copilotCommand();
    return s.platform.interactiveShell();
  };

  const spawnTerminal = (task: Task, def: TerminalDef) => {
    const cmd = terminalCommand(task, def);
    s.terminals.spawn({
      id: def.id,
      taskId: task.id,
      cwd: task.worktreePath,
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
      defs.push({ id: randomUUID(), kind: 'claude', label: 'Claude Code' });
    if (task.setup.openCopilot)
      defs.push({ id: randomUUID(), kind: 'copilot', label: 'Copilot CLI' });
    if (task.setup.openShell)
      defs.push({
        id: randomUUID(),
        kind: 'shell',
        label: s.platform.shellLabel,
      });
    return defs;
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

  const buildPlan = async (task: Task): Promise<SetupPlan> => {
    const repo = s.repos.get(task.repoId);
    const config = await s.loadConfig(repo.path);
    const defs = initialTerminals(task);
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
    };
  };

  /** Runs the setup. The caller must hold the in-flight claim; it is released before the final 'finished' event. */
  const runSetup = async (taskId: string, fromStep?: number): Promise<void> => {
    let state: SetupState | undefined;
    let finishedEvent: SetupEvent | null = null;
    try {
      const task = taskById(taskId);
      const plan = await buildPlan(task);
      const steps = planSteps(plan);
      const current: SetupState = {
        steps: steps.map((def) => ({ def, status: 'todo' })),
        log: [],
        finished: false,
        ok: null,
        failedStep: null,
      };
      state = current;
      setupStates.set(taskId, current);
      const result = await s.runner.run(plan, {
        fromStep,
        onEvent: (e) => {
          applySetupEvent(current, e);
          // Hold back 'finished' until the task status is persisted, so listeners never see a stale status.
          if (e.type === 'finished') finishedEvent = e;
          else s.broadcast('setup', e);
        },
        startTerminals: async () => {
          const defs = initialTerminals(task);
          for (const def of defs)
            spawnTerminal({ ...task, terminals: defs }, def);
          await updateTerminals(taskId, (list) => [...list, ...defs]);
        },
      });
      await patchTask(taskId, { status: result.ok ? 'ready' : 'setup-failed' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      s.broadcast('notice', {
        level: 'error',
        message: `Setup failed: ${message}`,
      });
      if (state) {
        state.finished = true;
        state.ok = false;
      }
      finishedEvent = { taskId, type: 'finished', ok: false };
      try {
        await patchTask(taskId, { status: 'setup-failed' });
      } catch {
        // the store itself is failing; nothing more we can persist
      }
    } finally {
      release(taskId);
    }
    if (finishedEvent) s.broadcast('setup', finishedEvent);
  };

  const startSetupInBackground = (taskId: string, fromStep?: number) => {
    void runSetup(taskId, fromStep);
  };

  return {
    'repos:list': async () => s.repos.list(),
    'repos:add': async (folder) => {
      const repo = await s.repos.add(folder);
      s.broadcast('repos:changed', s.repos.list());
      return repo;
    },
    'repos:remove': async (id) => {
      await s.repos.remove(id);
      s.broadcast('repos:changed', s.repos.list());
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
      const slug = taskSlug(input.workItem, input.name);
      const worktreePath = path.join(worktreeRoot(repo.path), slug);
      if (await exists(worktreePath))
        throw new Error(`Folder ${worktreePath} already exists`);
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
      await tasksChanged();
      return task;
    },
    'tasks:setupState': async (taskId) => setupStates.get(taskId) ?? null,
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
    },
    'tasks:cancelSetup': async (taskId) => {
      claim(taskId, ['setup-failed'], 'cancel the setup of');
      try {
        const task = taskById(taskId);
        const repo = s.repos.get(task.repoId);
        // Windows will not remove a folder that a running process has as its cwd.
        await s.terminals.killAllForTask(taskId);
        if (await exists(task.worktreePath))
          await s.git.worktreeRemove(repo.path, task.worktreePath, true);
        await s.git.worktreePrune(repo.path);
        if (await s.git.branchExists(repo.path, task.branch))
          await s.git.deleteBranch(repo.path, task.branch);
        setupStates.delete(taskId);
        await s.store.update((st) => {
          st.tasks = st.tasks.filter((t) => t.id !== taskId);
        });
        await tasksChanged();
      } finally {
        release(taskId);
      }
    },
    'tasks:gitSummary': async (taskId) => {
      const task = taskById(taskId);
      return s.git.summary(task.worktreePath, task.baseRef);
    },
    'tasks:finishChecks': async (taskId) => {
      const task = taskById(taskId);
      const summary = await s.git.summary(task.worktreePath, task.baseRef);
      return {
        uncommitted: summary.files,
        unpushed: summary.ahead,
        runningTerminals: s.terminals.runningCount(taskId),
      };
    },
    'tasks:finish': async (taskId, options) => {
      claim(taskId, ['ready'], 'finish');
      try {
        const task = taskById(taskId);
        const repo = s.repos.get(task.repoId);
        await patchTask(taskId, { status: 'finishing' });
        // A terminal running in the folder blocks its removal on Windows (and a terminal without its
        // folder is useless), so removing the worktree closes the terminals even when that was unticked.
        const killTerminals = options.closeTerminals || options.removeWorktree;
        try {
          if (killTerminals) {
            await s.terminals.killAllForTask(taskId);
            await patchTask(taskId, { terminals: [] });
          }
          if (options.removeWorktree && (await exists(task.worktreePath)))
            await s.git.worktreeRemove(repo.path, task.worktreePath, true);
          if (options.deleteBranch) {
            // A deleted folder leaves a stale registration that blocks branch deletion.
            // A folder that still exists keeps the refusal, which protects uncommitted work.
            await s.git.worktreePrune(repo.path);
            await s.git.deleteBranch(repo.path, task.branch);
          }
        } catch (e) {
          await patchTask(taskId, { status: 'ready' });
          throw e;
        }
        await patchTask(taskId, {
          status: 'done',
          finishedAt: new Date().toISOString(),
        });
        if (options.syncUsage) {
          try {
            if (killTerminals && s.finishFlushMs > 0)
              await new Promise((r) => setTimeout(r, s.finishFlushMs));
            await s.copilot.poll();
            const result = await usageSync.syncTask(taskId, {
              comment: true,
              refreshFields: true,
            });
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
    },

    'terminals:open': async (taskId, def) => {
      claim(taskId, ['ready'], 'open a terminal in');
      let full: TerminalDef;
      try {
        full = { id: randomUUID(), ...def };
        spawnTerminal(taskById(taskId), full);
      } finally {
        release(taskId);
      }
      await updateTerminals(taskId, (list) => [...list, full]);
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
      if (owner)
        await updateTerminals(owner.id, (list) =>
          list.filter((x) => x.id !== id),
        );
    },
    'terminals:restart': async (id) => {
      if (s.terminals.isRunning(id) || s.terminals.has(id)) {
        s.terminals.restart(id);
        return;
      }
      // After an app relaunch the manager is empty while the task still lists its terminals.
      const owner = s.store.state.tasks.find((t) =>
        t.terminals.some((x) => x.id === id),
      );
      const def = owner?.terminals.find((x) => x.id === id);
      if (!owner || !def) throw new Error(`Unknown terminal ${id}`);
      if (owner.status !== 'ready')
        throw new Error(
          `Cannot restart a terminal of a task that is ${owner.status}`,
        );
      spawnTerminal(owner, def);
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
      const { user } = await probe.verify(input.project.trim());
      const saved = await s.connections.save(input);
      s.ado.invalidate(saved.id);
      const verified = await s.connections.setStatus(saved.id, 'ok', user);
      connectionsChanged();
      return verified;
    },
    'connections:remove': async (id) => {
      s.connections.get(id);
      for (const r of s.repos.list())
        if (r.connectionId === id) await s.repos.setConnection(r.id, null);
      await s.connections.remove(id);
      s.ado.invalidate(id);
      connectionsChanged();
      s.broadcast('repos:changed', s.repos.list());
    },
    'connections:verify': async (id) => verifyConnection(id),
    'repos:setConnection': async (repoId, connectionId) => {
      if (connectionId !== null) s.connections.get(connectionId);
      const repo = await s.repos.setConnection(repoId, connectionId);
      s.broadcast('repos:changed', s.repos.list());
      return repo;
    },
    'workItems:currentIteration': async (connectionId) => {
      const c = s.connections.get(connectionId);
      return withConnection(connectionId, () =>
        s.ado.client(connectionId).currentIteration(c.project),
      );
    },
    'workItems:search': async (connectionId, search) => {
      const c = s.connections.get(connectionId);
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
    'usage:sync': async (taskId) =>
      usageSync.syncTask(taskId, {
        refreshFields: true,
        // A done task still owes its one usage comment if the write on finish failed.
        comment: taskById(taskId).status === 'done',
      }),
    'usage:exportCsv': async (taskId) => {
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
    'settings:get': async () => s.settings.get(),
    'settings:save': async (next) => {
      const before = s.settings.get();
      const saved = await s.settings.save(next);
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
