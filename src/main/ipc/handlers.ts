import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Events, Handlers, PendingUpdate } from '../../shared/ipc';
import { claudeContext, renderTaskMd, taskSlug } from '../../shared/naming';
import {
  claudeHasSessionsIn,
  claudeProjectsDir,
  claudeSessionExists,
} from '../services/claudeSessions';
import { WorkspaceDetector } from '../workspaces/WorkspaceDetector';
import type {
  Connection,
  ConnectionInput,
  FinishOptions,
  FinishRowResult,
  ShellieConfig,
  PullRequestRef,
  SetupEvent,
  SetupState,
  Task,
  TaskStatus,
  TaskSummary,
  TaskView,
  TerminalDef,
  WorkItemTypeMeta,
  WorkspaceAction,
  WorkspaceCheck,
} from '../../shared/types';
import {
  activeHome,
  activeWorkspaces,
  HOME_ID,
  isReopening,
  taskConnectionId,
  taskWorkspaces,
  workspaceById,
  type WorkspaceView,
  parseDocsTarget,
} from '../../shared/workspaces';
import { pathExists } from '../fsRetry';
import { worktreeRoot } from '../paths';
import type { BudgetService } from '../budget/BudgetService';
import { HomeService } from '../home/HomeService';
import { homeStats } from '../home/homeStats';
import { DocsWatcher } from '../docs/DocsWatcher';
import { GitDirWatcher } from '../review/GitDirWatcher';
import type { AgentsDetected } from '../../shared/agents';
import {
  detectAgents,
  runProbe,
  type ProbeRunner,
} from '../services/agentDetector';
import { createEditorHandlers } from '../editors/editorHandlers';
import {
  detectEditors,
  scanProject,
  systemDetectDeps,
} from '../editors/editors';
import { EditorService } from '../editors/EditorService';
import { createReviewHandlers } from '../review/reviewHandlers';
import { ReviewService } from '../review/ReviewService';
import { ReviewStore } from '../review/ReviewStore';
import { createDocsHandlers } from '../docs/docsHandlers';
import { SessionDocs } from '../docs/sessionDocs';
import type { AttentionHub } from '../attention/AttentionHub';
import type { ActivityTracker } from '../time/ActivityTracker';
import { baselineKey, createTimeHandlers } from '../time/timeHandlers';
import { closestMeasure, planTimeWrite } from '../time/timeWriteBack';
import type { TimeStore } from '../time/TimeStore';
import type { Command, Platform } from '../platform/Platform';
import { OFFICIAL_RATES, OFFICIAL_RATES_AS_OF } from '../pricing/officialRates';
import { AdoClient, AdoError } from '../services/AdoClient';
import type { TrackerRegistry } from '../trackers/TrackerRegistry';
import {
  TokenUnavailableError,
  type ConnectionStore,
} from '../services/ConnectionStore';
import {
  organizationOf,
  prAvailability,
  prDescription,
  prTitle,
  prWebUrl,
  targetBranch,
} from '../services/azureRepos';
import { GitAuthError, type GitClient } from '../services/GitClient';
import type { RepoRegistry } from '../services/RepoRegistry';
import { inspectRepo } from '../services/repoInspect';
import {
  planSteps,
  type ExtraRestore,
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
import type { ColorScheme, ThemeChoice } from '../../shared/theme';
import { colorFgBg } from '../services/claudeTheme';
import type { TerminalFailures } from '../services/TerminalFailures';
import type { TimeBooking } from '../../shared/time';
import { errorMessage } from '../../shared/errors';
import { OFFICIAL_USD_TO_EUR } from '../../shared/usage';

export type Services = {
  /** What needs the developer's attention (main); absent in tests. */
  attention?: Pick<AttentionHub, 'setView' | 'snapshot'>;
  /** Extra env per terminal (main: the attention URL and token, OpenCode's plugin). */
  terminalEnv?: (def: TerminalDef) => Record<string, string>;
  store: TaskStore;
  git: GitClient;
  platform: Platform;
  repos: RepoRegistry;
  connections: ConnectionStore;
  trackers: TrackerRegistry;
  openExternal: (url: string) => Promise<void>;
  /** Shows a file in Finder or Explorer (main uses shell.showItemInFolder). */
  revealFile?: (absPath: string) => void;
  /** Opens a folder in Explorer or Finder; resolves to an error message, empty on success (shell.openPath). */
  openPath?: (absPath: string) => Promise<string>;
  /** Serves an HTML file in a Shellie tab (main: HtmlViews.grant); absent in tests, where opening one fails. */
  grantView?: (realFile: string) => string;
  /** Owned by main so it can stop on quit; handlers create their own when absent (tests). */
  docsWatcher?: DocsWatcher;
  /** Watches worktrees' git dirs for the Changes page; owned by main so it stops on quit. */
  gitDirWatcher?: GitDirWatcher;
  /** Where `review/<taskId>.json` files live (main: `<userData>/review`); defaults to `<usageDir>/review`. */
  reviewDir?: string;
  terminals: TerminalManager;
  runner: SetupRunner;
  loadConfig: (repoPath: string) => Promise<ShellieConfig>;
  pickFolder: () => Promise<string | null>;
  launch: (cmd: Command) => Promise<void>;
  /** Runs an agent probe with a timeout; defaults to `execFile` (tests inject a fake). */
  runProbe?: ProbeRunner;
  /** Editor detection and launch; handlers build one from platform, settings and launch when absent (tests). */
  editors?: EditorService;
  broadcast: <K extends keyof Events>(event: K, payload: Events[K]) => void;
  usage: UsageStore;
  /** Measured active and agent time per task. */
  time: TimeStore;
  /** Counts active time for the task on screen (main); absent in tests. */
  tracker?: Pick<ActivityTracker, 'setTask' | 'flush'>;
  /** Sees what is typed into a terminal (main estimates OpenCode agent time from it). */
  onTerminalInput?: (id: string, data: string) => void;
  settings: SettingsStore;
  /** The colour scheme on screen (main: nativeTheme); absent in tests, where terminals get no COLORFGBG. */
  colorScheme?: () => ColorScheme;
  /**
   * The settings file Claude Code tabs pass with --settings to pick a theme that suits the scheme on screen
   * (main: claudeTheme.ts), null to leave the user's theme; absent in tests.
   */
  claudeThemeSettings?: () => string | null;
  /** A Claude Code tab was started (or resumed) with the theme claudeThemeSettings gave. */
  claudeSpawned?: (terminalId: string) => void;
  /** Explains and logs agent tabs that fail to start (#109); absent in tests that don't care. */
  terminalFailures?: Pick<TerminalFailures, 'get' | 'clear' | 'spawnFailed'>;
  /** Sets nativeTheme.themeSource (main); absent in tests that don't care. */
  applyTheme?: (theme: ThemeChoice) => void;
  appVersion: string;
  /** Windows OS build number (e.g. 22631), null elsewhere. */
  windowsBuild?: number | null;
  receiver: Pick<UsageReceiver, 'start' | 'status'>;
  copilot: Pick<CopilotFileTailer, 'stats' | 'poll'>;
  usageDir: string;
  /** Home's snapshot builder; handlers build one in usageDir when absent (tests). */
  home?: HomeService;
  budget?: BudgetService;
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
  /** Finds and joins other repos' worktrees of a task; handlers build one from these services when absent (tests). */
  workspaces?: WorkspaceDetector;
  /** Windows auto-update: the downloaded update and how to apply it. Absent in dev, on macOS and in tests. */
  update?: {
    pending(): PendingUpdate | null;
    /** Quits and starts the update; false when none is downloaded. */
    install(): boolean;
  };
};

/** The task's open periods with a new one starting now (reopen). A task from before time tracking keeps creation to finish as its first. */
function withOpenPeriod(task: Task): Task['openPeriods'] {
  const now = new Date().toISOString();
  const before =
    task.openPeriods.length === 0
      ? [{ start: task.createdAt, end: task.finishedAt ?? now }]
      : withPeriodClosed(task, now);
  return [...before, { start: now, end: null }];
}

/** The task's open periods with the last one ended at `end`, when it is still open. */
function withPeriodClosed(task: Task, end: string): Task['openPeriods'] {
  return task.openPeriods.map((p, i, all) =>
    i === all.length - 1 && p.end === null ? { ...p, end } : p,
  );
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
  const tel = s.telemetry ?? NoopTelemetry;
  let agentsCache: AgentsDetected | null = null;
  const sessionExists = s.claudeSessionExists ?? claudeSessionExists;
  const hasSessionsIn = s.claudeHasSessionsIn ?? claudeHasSessionsIn;
  const connectionsChanged = () =>
    s.broadcast('connections:changed', s.connections.list());
  const reposChanged = () => s.broadcast('repos:changed', s.repos.list());

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

  const home =
    s.home ??
    new HomeService({
      file: path.join(s.usageDir, 'home.json'),
      connections: () => s.connections.list(),
      client: (id) => s.trackers.client(id),
      withConnection,
      onBuilt: (snapshot, info) => {
        s.broadcast('home:updated', snapshot);
        tel.event(
          'home.refreshed',
          { connections: info.connections, failed: info.failed },
          { durationMs: info.durationMs },
        );
        for (const f of info.failures)
          tel.event('home.failed', { kind: f.kind });
      },
    });

  const verifyConnection = async (
    connectionId: string,
  ): Promise<Connection> => {
    const c = s.connections.get(connectionId);
    const { user, uniqueName } = await withConnection(connectionId, () =>
      s.trackers.tracker(connectionId).probe(c.project),
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

  const saveConnection = async (
    input: ConnectionInput,
  ): Promise<Connection> => {
    // Verify with a throwaway client before anything is written, so a bad token never lands on disk.
    s.connections.assertCanSave(input);
    const organizationUrl = s.connections.normalizeUrl(input.organizationUrl);
    const probe = new AdoClient(organizationUrl, async () => input.pat.trim());
    const { user, uniqueName } = await probe.verify(input.project.trim());
    const saved = await s.connections.save(input);
    s.trackers.invalidate(saved.id);
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
    // A tracker after all: the earlier No-tracker choice no longer holds.
    const current = s.settings.get();
    if (current.onboarding.tracker === 'none')
      await s.settings.save({
        ...current,
        onboarding: { ...current.onboarding, tracker: null },
      });
    return verified;
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
          // The task's working folder: the home unless Finish dropped it, then the repo that took over.
          !(await pathExists(activeHome(t).worktreePath)),
      })),
    );

  const tasksChanged = async () =>
    s.broadcast('tasks:changed', await listTasks());

  /** Changes one stored task (if it is still there) in a single store write, then tells the windows. */
  const mutateTask = async (id: string, change: (t: Task) => void) => {
    await s.store.update((st) => {
      const t = st.tasks.find((x) => x.id === id);
      if (t) change(t);
    });
    await tasksChanged();
  };

  const patchTask = (id: string, patch: Partial<Task>) =>
    mutateTask(id, (t) => Object.assign(t, patch));

  /**
   * Where a workspace's pull request would go (the home's by default): its repo's connection and `origin`
   * parsed as Azure Repos. The PR links the work item only when that connection is in the work item's
   * organization.
   */
  const prContext = async (
    task: Task,
    w: WorkspaceView = taskWorkspaces(task)[0],
  ) => {
    const repo = s.repos.get(w.repoId);
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
    const taskConnId = taskConnectionId(task, s.repos.list());
    let taskOrg: string | null = null;
    try {
      taskOrg = taskConnId
        ? organizationOf(s.connections.get(taskConnId).organizationUrl)
        : null;
    } catch {
      taskOrg = null;
    }
    return {
      connection,
      availability,
      target: targetBranch(w.baseRef, remotes),
      linksWorkItem:
        Boolean(task.workItem) &&
        connection !== null &&
        taskOrg !== null &&
        organizationOf(connection.organizationUrl) === taskOrg,
    };
  };

  /** Cost goes to Azure DevOps (work items, PR descriptions) only when the user turned it on. */
  const writeCost = () => s.settings.get().writeCostToAdo;
  const costLineFor = (taskId: string) =>
    writeCost() ? renderCostLine(s.usage.summarize(taskId)) : null;

  /** The connection and project of the task's work item (its own, else its home repo's), null when there is none. */
  const adoTarget = (
    task: Task,
  ): { connectionId: string; project: string } | null => {
    const connectionId = taskConnectionId(task, s.repos.list());
    if (!connectionId) return null;
    try {
      return {
        connectionId,
        project: s.connections.get(connectionId).project,
      };
    } catch {
      return null;
    }
  };

  const usageSync = new UsageSync({
    task: taskById,
    tasks: () => s.store.state.tasks,
    target: adoTarget,
    client: (connectionId) => s.trackers.client(connectionId),
    run: withConnection,
    usage: (taskId) => s.usage.summarize(taskId),
    changedSince: (iso) => s.usage.changedSince(iso),
    patchTask,
  });
  /** Booked time goes to Azure DevOps (Completed and Remaining Work) only when the user turned it on. */
  const writeTime = () => s.settings.get().writeTimeToAdo;
  const timeWrites = new Map<string, Promise<unknown>>();
  /**
   * Writes the difference between the task's booked hours and what was written before to its work item, one write
   * per task at a time. Records the outcome on the booking; returns the error message, null on success.
   */
  const syncTime = (taskId: string): Promise<string | null> => {
    const run = async (): Promise<string | null> => {
      const task = taskById(taskId);
      const booking = task.time;
      const workItem = task.workItem;
      const target = adoTarget(task);
      if (!booking || !workItem || !target)
        return 'This task has no booked time on a work item in a connected Azure DevOps project';
      const patchBooking = async (patch: Partial<TimeBooking>) => {
        const latest = taskById(taskId).time;
        if (latest) await patchTask(taskId, { time: { ...latest, ...patch } });
      };
      try {
        const hours = await withConnection(target.connectionId, async () => {
          const client = s.trackers.tracker(target.connectionId);
          const id = Number(workItem.id);
          const current = await client.itemEstimate(id);
          const type = (current.type || workItem.type).toLowerCase();
          const fieldsOf = async (refresh: boolean) =>
            (
              await usageSync.typeFields(
                target.connectionId,
                target.project,
                refresh,
              )
            ).find((t) => t.type.toLowerCase() === type)?.fields;
          // A type missing from the cache (added or renamed since) is looked up again once before writing nothing.
          const fields = (await fieldsOf(false)) ?? (await fieldsOf(true));
          const plan = planTimeWrite({
            bookedSeconds: booking.bookedSeconds,
            writtenHours: booking.writtenHours,
            current,
            fields: fields ?? [],
          });
          if (plan) await client.updateItemFields(id, plan.patch);
          return plan?.hours ?? booking.writtenHours;
        });
        await patchBooking({ writtenHours: hours, syncError: null });
        return null;
      } catch (e) {
        const message = errorMessage(e);
        await patchBooking({ syncError: message }).catch(() => undefined);
        return message;
      }
    };
    const next = (timeWrites.get(taskId) ?? Promise.resolve()).then(run);
    const tail = next.catch(() => undefined);
    timeWrites.set(taskId, tail);
    void tail.then(() => {
      if (timeWrites.get(taskId) === tail) timeWrites.delete(taskId);
    });
    return next;
  };

  /** Books the time chosen at Finish on a done task, then writes it to the work item when that is on. Never throws. */
  const bookTime = async (taskId: string, bookedSeconds: number) => {
    try {
      // The open interval holds up to a minute of unflushed active time: write it before measuring.
      s.tracker?.flush();
      await s.time.settled();
      const task = taskById(taskId);
      const m = s.time.summarize(task, s.settings.get().workHours, Date.now());
      await patchTask(taskId, {
        time: {
          bookedSeconds,
          measuredSeconds: m.activeSeconds,
          realisticSeconds: m.realisticSeconds,
          wallClockSeconds: m.wallClockSeconds,
          agentSeconds: m.agentSeconds,
          bookedAt: new Date().toISOString(),
          writtenHours: task.time?.writtenHours ?? 0,
          syncError: null,
        },
      });
      tel.event('time.booked', {
        closest: closestMeasure(bookedSeconds, {
          measured: m.activeSeconds,
          realistic: m.realisticSeconds,
          wallClock: m.wallClockSeconds,
        }),
      });
      if (!writeTime() || !task.workItem || !adoTarget(task)) return;
      const error = await syncTime(taskId);
      if (error)
        s.broadcast('notice', {
          level: 'warn',
          message: `Task finished, but the time could not be written to the work item: ${error}. Use Retry on the Done page.`,
        });
    } catch (e) {
      console.error('[time] booking on finish failed', e);
    }
  };

  /** The estimate baseline of a work item, from its live fields when a task starts on it. Never throws. */
  const recordBaseline = async (task: Task) => {
    const target = adoTarget(task);
    if (!task.workItem || !target) return;
    try {
      const e = await withConnection(target.connectionId, () =>
        s.trackers
          .tracker(target.connectionId)
          .itemEstimate(Number(task.workItem!.id)),
      );
      if (e.originalEstimate === null && e.remainingWork !== null)
        await s.time.recordBaseline(
          baselineKey(target.connectionId, task.workItem.id),
          e.remainingWork + (e.completedWork ?? 0),
        );
    } catch {
      // A missing baseline falls back to the live fields.
    }
  };

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
  ) =>
    mutateTask(id, (t) => {
      t.terminals = change(t.terminals);
    });

  /** The workspace a terminal runs in; a removed or dropped one falls back to the active home. */
  const terminalWorkspace = (task: Task, def: TerminalDef) => {
    const w = taskWorkspaces(task).find((x) => x.id === def.workspaceId);
    return w && !w.dropped ? w : activeHome(task);
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
      const cwd = terminalWorkspace(task, def).worktreePath;
      const dirs = activeWorkspaces(task)
        // A folder removed by hand would make Claude refuse to start.
        .filter((w) => w.worktreePath !== cwd && existsSync(w.worktreePath))
        .flatMap((w) => ['--add-dir', w.worktreePath]);
      const themeFile = s.claudeThemeSettings?.() ?? null;
      const theme = themeFile ? ['--settings', themeFile] : [];
      if (resume && !def.sessionId)
        return s.platform.claudeCommand(null, [
          '--continue',
          ...dirs,
          ...theme,
        ]);
      if (resume && def.sessionId && sessionExists(def.sessionId))
        return s.platform.claudeCommand(null, [
          '--resume',
          def.sessionId,
          ...dirs,
          ...theme,
        ]);
      return s.platform.claudeCommand(claudeContext(task), [
        ...(def.sessionId ? ['--session-id', def.sessionId] : []),
        ...dirs,
        ...theme,
      ]);
    }
    if (def.kind === 'run' && def.setupCommands)
      return s.platform.setupCommands(def.setupCommands);
    if (def.kind === 'run' && def.command)
      return s.platform.runCommand(def.command);
    if (def.kind === 'copilot') return s.platform.copilotCommand();
    if (def.kind === 'opencode') return s.platform.opencodeCommand();
    return s.platform.interactiveShell();
  };

  const spawnTerminal = (
    task: Task,
    def: TerminalDef,
    resume = false,
    extraEnv: Record<string, string> = {},
  ) => {
    s.terminalFailures?.clear(def.id);
    try {
      const cmd = terminalCommand(task, def, resume);
      s.terminals.spawn({
        id: def.id,
        taskId: task.id,
        cwd: terminalWorkspace(task, def).worktreePath,
        command: cmd.command,
        args: cmd.args,
        env: {
          ...telemetryEnv(task.id, s.settings.get().receiverPort, s.usageDir),
          ...(s.colorScheme ? { COLORFGBG: colorFgBg(s.colorScheme()) } : {}),
          ...s.terminalEnv?.(def),
          ...cmd.env,
          ...extraEnv,
        },
      });
    } catch (e) {
      s.terminalFailures?.spawnFailed(def.id, def.kind, e);
      throw e;
    }
    if (def.kind === 'claude') s.claudeSpawned?.(def.id);
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
    if (task.setup.openOpencode)
      defs.push({ id: randomUUID(), kind: 'opencode', label: 'OpenCode' });
    if (task.setup.openShell)
      defs.push({
        id: randomUUID(),
        kind: 'shell',
        label: s.platform.shellLabel,
      });
    return defs;
  };

  /** The Setup tab, last in the row, running the task's setup commands. */
  const setupTerminal = (commands: string[]): TerminalDef => ({
    id: randomUUID(),
    kind: 'run',
    label: 'Setup',
    setupCommands: commands,
  });

  /** A task's tabs without its Setup tab: setup commands never run again by themselves. */
  const withoutSetupTab = (defs: TerminalDef[]) =>
    defs.filter((d) => !d.setupCommands);

  /** apm targets: the harness of each tab, in order, once. */
  const apmTargetsFor = (defs: TerminalDef[]): string[] => [
    ...new Set(
      defs.flatMap((d) =>
        d.kind === 'claude' || d.kind === 'copilot' || d.kind === 'opencode'
          ? [d.kind]
          : [],
      ),
    ),
  ];

  /**
   * The tabs a reopened task gets back: those it had at Finish, or for tasks finished before that was kept, the
   * ones setup opens. A Claude tab without a session id continues the folder's latest session when there is one.
   */
  const restoredTerminals = (task: Task): TerminalDef[] => {
    const defs =
      task.closedTerminals.length > 0
        ? withoutSetupTab(task.closedTerminals)
        : initialTerminals(task).map((d): TerminalDef => {
            const { sessionId: _, ...rest } = d as TerminalDef;
            return rest;
          });
    return defs.map((d) =>
      d.kind === 'claude' &&
      !d.sessionId &&
      !hasSessionsIn(activeHome(task).worktreePath)
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
        if (e.status === 'failed' && e.auth) step.auth = e.auth;
        else delete step.auth;
      }
    } else {
      state.finished = true;
      state.ok = e.ok;
      state.failedStep = e.failedStep ?? null;
    }
  };

  /** The other repos a reopen makes again, each with its own .shellie.yml copies and setup commands. */
  const extraRestores = async (task: Task): Promise<ExtraRestore[]> => {
    const out: ExtraRestore[] = [];
    for (const w of task.extraWorkspaces) {
      if (w.dropped || w.reopen === null) continue;
      const repo = s.repos.get(w.repoId);
      const config = await s.loadConfig(repo.path);
      out.push({
        workspaceId: w.id,
        repoName: repo.name,
        repoPath: repo.path,
        worktreePath: w.worktreePath,
        branch: w.branch,
        from: w.reopen.from,
        copy: task.setup.copy ? config.copy : [],
        commands: config.setup,
      });
    }
    return out;
  };

  /** Clears every workspace's reopen mark, in the same store write as `patch`. */
  const endReopen = (taskId: string, patch: Partial<Task>) =>
    mutateTask(taskId, (t) => {
      Object.assign(t, patch, { reopen: null });
      for (const w of t.extraWorkspaces) w.reopen = null;
    });

  /**
   * Where a reopened workspace's branch comes from: the local branch (null), else `origin/<branch>`, else the last
   * commit of its Finish summary, else its base when the branch had no commits.
   */
  const restoreSource = async (
    repoPath: string,
    ws: Pick<
      WorkspaceView,
      'id' | 'repoId' | 'branch' | 'summary' | 'baseSha' | 'baseRef'
    >,
  ): Promise<{
    from: string | null;
    via: 'branch' | 'origin' | 'commit' | 'base';
  }> => {
    if (await s.git.branchExists(repoPath, ws.branch))
      return { from: null, via: 'branch' };
    const remote = `origin/${ws.branch}`;
    await s.git.fetch(repoPath, remote).catch(() => false);
    const head = ws.summary?.commits[0]?.sha;
    if (await s.git.commitExists(repoPath, `refs/remotes/${remote}`))
      return { from: remote, via: 'origin' };
    if (head && (await s.git.commitExists(repoPath, head)))
      return { from: head, via: 'commit' };
    if (ws.summary && ws.summary.commitCount === 0)
      return { from: ws.baseSha ?? ws.baseRef, via: 'base' };
    // The home keeps the message it had before #48; another repo's names that repo.
    const what =
      ws.id === HOME_ID
        ? `Branch ${ws.branch}`
        : `${s.repos.list().find((r) => r.id === ws.repoId)?.name ?? path.basename(repoPath)}: branch ${ws.branch}`;
    throw new Error(
      `${what} cannot be restored: it was deleted and is not on origin`,
    );
  };

  const buildPlan = async (task: Task): Promise<SetupPlan> => {
    const repo = s.repos.get(task.repoId);
    const config = await s.loadConfig(repo.path);
    const reopening = isReopening(task);
    const defs = reopening ? restoredTerminals(task) : initialTerminals(task);
    const hasApm =
      config.apm !== false &&
      (await pathExists(path.join(repo.path, 'apm.yml')));
    return {
      taskId: task.id,
      repoPath: repo.path,
      worktreePath: task.worktreePath,
      branch: task.branch,
      baseRef: task.baseRef,
      copy: task.setup.copy ? config.copy : [],
      commands: task.setup.commands,
      cloneNodeModules:
        Boolean(s.platform.cloneDir) &&
        task.setup.commands.some((c) => c.trim() === 'npm ci'),
      apmTargets: hasApm ? config.apm || apmTargetsFor(defs) : [],
      taskMd: renderTaskMd(
        task,
        Object.fromEntries(
          taskWorkspaces(task).flatMap((w) => {
            try {
              return [[w.repoId, s.repos.get(w.repoId).path]];
            } catch {
              return [];
            }
          }),
        ),
      ),
      startTerminalsLabel:
        defs.length > 0 ? defs.map((d) => d.label).join(', ') : null,
      // A reopened task leaves its work item alone.
      updateWorkItem:
        !reopening &&
        Boolean(
          task.workItem &&
          taskConnectionId(task, [repo]) &&
          (repo.workItemOnStart.moveToInProgress ||
            repo.workItemOnStart.assignToMe),
        ),
      ...(task.reopen ? { restore: { from: task.reopen.from } } : {}),
      ...(reopening
        ? {
            // Only workspaces Reopen marked are made again; the home's mark is absent when dropped or kept.
            skipHome: task.reopen === null,
            extraRestores: await extraRestores(task),
          }
        : {}),
    };
  };

  /** Runs the setup. The caller must hold the in-flight claim; it is released before the final 'finished' event. */
  const runSetup = async (taskId: string, fromStep?: number): Promise<void> => {
    let state: SetupState | undefined;
    let finishedEvent: SetupEvent | null = null;
    const t0 = Date.now();
    let steps: ReturnType<typeof planSteps> = [];
    const report = (ok: boolean, failedStep: number | null) =>
      tel.event(
        'setup.finished',
        {
          ok,
          retry: fromStep !== undefined,
          failedStep:
            failedStep === null
              ? 'none'
              : (steps[failedStep]?.kind ?? 'unknown'),
        },
        { durationMs: Date.now() - t0, steps: steps.length },
      );
    try {
      const task = taskById(taskId);
      const plan = await buildPlan(task);
      steps = planSteps(plan);
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
        onBaseSha: async (baseSha) => {
          await patchTask(taskId, { baseSha });
        },
        startTerminals: async (commands) => {
          const setupTab = commands.length > 0 ? [setupTerminal(commands)] : [];
          if (isReopening(task)) {
            const restored = restoredTerminals(task);
            startRestored(task, restored);
            for (const def of setupTab) {
              spawnTerminal({ ...task, terminals: restored }, def);
              tel.event('terminal.opened', { kind: def.kind, initial: true });
            }
            await updateTerminals(taskId, () => [...restored, ...setupTab]);
            return;
          }
          const defs = [...initialTerminals(task), ...setupTab];
          for (const def of defs) {
            spawnTerminal({ ...task, terminals: defs }, def);
            tel.event('terminal.opened', { kind: def.kind, initial: true });
          }
          await updateTerminals(taskId, (list) => [...list, ...defs]);
        },
        updateWorkItem: async () => {
          try {
            const repo = s.repos.get(task.repoId);
            const connection = s.connections.get(
              taskConnectionId(task, [repo])!,
            );
            const client = s.trackers.tracker(connection.id);
            const id = Number(task.workItem!.id);
            const current = await client.itemForStart(id);
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
              await client.updateItem(id, {
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
      if (result.ok && isReopening(task))
        await endReopen(taskId, {
          status: 'ready',
          finishedAt: null,
          closedTerminals: [],
        });
      else
        await patchTask(taskId, {
          status: result.ok ? 'ready' : 'setup-failed',
        });
      report(result.ok, result.ok ? null : current.failedStep);
    } catch (e) {
      const message = errorMessage(e);
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

  const workspaces =
    s.workspaces ??
    new WorkspaceDetector({
      store: s.store,
      git: s.git,
      repos: s.repos,
      connections: () => s.connections.list(),
      projectsDir: () => claudeProjectsDir(),
      notice: (message) => s.broadcast('notice', { level: 'info', message }),
      event: (n, p) => tel.event(n, p),
    });

  const gitDirWatcher =
    s.gitDirWatcher ??
    new GitDirWatcher(
      (wt) => s.git.gitDir(wt),
      (target) => s.broadcast('review:changed', { taskId: target }),
      undefined,
      (target) => docsWatcher.stopTarget(target),
    );
  const sessionDocs = new SessionDocs({
    git: s.git,
    projectsDir: () => claudeProjectsDir(),
  });
  const docsWatcher =
    s.docsWatcher ??
    new DocsWatcher(
      (taskId, paths) => {
        sessionDocs.invalidate(parseDocsTarget(taskId).taskId);
        s.broadcast('docs:changed', { taskId, paths });
      },
      undefined,
      (taskId) => {
        gitDirWatcher.stopTarget(taskId);
        s.broadcast('docs:watchStopped', { taskId });
      },
    );
  const review = new ReviewService({
    git: s.git,
    store: new ReviewStore(s.reviewDir ?? path.join(s.usageDir, 'review'), () =>
      s.broadcast('notice', {
        level: 'warn',
        message:
          'The review notes of a task could not be read and were started again',
      }),
    ),
    repoName: (id) => s.repos.list().find((r) => r.id === id)?.name ?? id,
    collapseOf: async (wt) => (await s.loadConfig(wt)).reviewCollapse ?? [],
  });
  const editors =
    s.editors ??
    new EditorService({
      platform: s.platform,
      detect: () => detectEditors(systemDetectDeps()),
      scan: scanProject,
      prefs: () => s.settings.get().editor,
      savePrefs: async (editor) => {
        await s.settings.save({ ...s.settings.get(), editor });
      },
      launch: s.launch,
      event: (n, p) => tel.event(n, p),
    });

  /** What a workspace's branch did since its base; a summary must never block Finish, so a failure is null. */
  const summaryOf = (
    w: Pick<WorkspaceView, 'worktreePath' | 'baseRef' | 'baseSha' | 'branch'>,
  ) =>
    s.git
      .finishSummary(w.worktreePath, {
        baseRef: w.baseRef,
        baseSha: w.baseSha,
        branch: w.branch,
      })
      .catch(() => null);

  /** What the Finish page shows for one workspace; a folder removed by hand is `missing`, never an error. */
  const workspaceCheck = async (
    task: Task,
    w: WorkspaceView,
  ): Promise<WorkspaceCheck> => {
    const repoName =
      s.repos.list().find((r) => r.id === w.repoId)?.name ?? w.repoId;
    const [pr, exists] = await Promise.all([
      prContext(task, w).catch((e: unknown) => ({
        connection: null,
        availability: {
          available: false,
          reason: errorMessage(e),
          target: null,
        },
        target: null,
        linksWorkItem: false,
      })),
      pathExists(w.worktreePath),
    ]);
    const base = {
      workspaceId: w.id,
      repoId: w.repoId,
      repoName,
      branch: w.branch,
      pr: {
        available: pr.availability.available,
        reason: pr.availability.reason,
        target: pr.availability.available ? pr.target : null,
        linksWorkItem: pr.linksWorkItem,
      },
    };
    if (!exists)
      return {
        ...base,
        baseKnown: true,
        missing: true,
        uncommitted: [],
        unpushed: 0,
        commits: 0,
      };
    const [summary, since] = await Promise.all([
      s.git.summary(w.worktreePath, w.baseRef),
      summaryOf(w),
    ]);
    const baseKnown = since?.baseKnown ?? false;
    return {
      ...base,
      missing: false,
      uncommitted: summary.files,
      unpushed: summary.ahead,
      commits: since && baseKnown ? since.commitCount : summary.ahead,
      baseKnown,
    };
  };

  /** Whether Finish may clean up a workspace: only one on the task's own branch. */
  const ownBranch = (task: Task, w: WorkspaceView) => w.branch === task.branch;

  /** Each row's outcome of the last Finish with workspaces, so the page can show them after a failure. */
  const finishResults = new Map<string, FinishRowResult[]>();

  /** A summary taken before the push would say "local only" on the Done page. */
  const markPushed = (
    summary: TaskSummary | null,
    branch: string,
  ): TaskSummary | null =>
    summary ? { ...summary, pushed: true, upstream: `origin/${branch}` } : null;

  /** True when `origin/<branch>` already contains HEAD, so a retry does not push again. */
  const onOrigin = (summary: TaskSummary | null, branch: string) =>
    Boolean(summary?.pushed && summary.upstream === `origin/${branch}`);

  /** Pushes a workspace's branch unless `origin` already has it; returns the summary as it is after the push. */
  const pushIfNeeded = async (
    w: WorkspaceView,
    summary: TaskSummary | null,
  ) => {
    if (onOrigin(summary, w.branch)) return summary;
    await s.git.push(w.worktreePath, 'origin', w.branch);
    return markPushed(summary, w.branch);
  };

  /** Pushes a workspace's branch (unless already there) and finds its active PR, else creates a draft one. */
  const openPullRequest = async (
    task: Task,
    w: WorkspaceView,
    summary: TaskSummary | null,
    costScope: { repos: number } | undefined,
  ): Promise<{
    ref: PullRequestRef;
    existed: boolean;
    summary: TaskSummary | null;
  }> => {
    const c = await prContext(task, w);
    if (!c.availability.available || !c.availability.target || !c.connection)
      throw new Error(
        c.availability.reason ?? 'pull requests are not available',
      );
    const connection = c.connection;
    const { project, repo: repoName } = c.availability.target;
    summary = await pushIfNeeded(w, summary);
    const client = s.trackers.tracker(connection.id);
    const repositoryId = await client.repositoryId(project, repoName);
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
          costLine: costLineFor(task.id),
          costScope,
          workItemUrl: c.linksWorkItem ? null : (task.workItem?.url ?? null),
        }),
        workItemId:
          task.workItem && c.linksWorkItem ? Number(task.workItem.id) : null,
      }));
    tel.event(existing ? 'pr.linked' : 'pr.created');
    return {
      existed: existing !== null,
      summary,
      ref: {
        id: raw.pullRequestId,
        url: prWebUrl(
          connection.organizationUrl,
          project,
          repoName,
          raw.pullRequestId,
        ),
        repositoryId,
        project,
        repo: repoName,
        status: raw.status,
        isDraft: raw.isDraft,
      },
    };
  };

  /** Sets a workspace's own fields: the task's flat ones for the home, else its entry in extraWorkspaces. */
  const setWorkspace = (
    t: Task,
    id: string,
    patch: {
      summary?: TaskSummary | null;
      pullRequest?: PullRequestRef;
      dropped?: boolean;
    },
  ) => {
    if (id === HOME_ID) {
      if (patch.summary !== undefined) t.summary = patch.summary;
      if (patch.pullRequest !== undefined) t.pullRequest = patch.pullRequest;
      if (patch.dropped !== undefined) t.homeDropped = patch.dropped;
      return;
    }
    const w = t.extraWorkspaces.find((x) => x.id === id);
    if (w) Object.assign(w, patch);
  };

  const patchWorkspace = (
    taskId: string,
    id: string,
    patch: Parameters<typeof setWorkspace>[2],
  ) => mutateTask(taskId, (t) => setWorkspace(t, id, patch));

  /** Closes the task's terminals (and its Docs watcher), keeping the tabs so Reopen can bring them back. */
  const closeTaskTerminals = async (taskId: string) => {
    docsWatcher.stopTask(taskId);
    gitDirWatcher.stopTask(taskId);
    await s.terminals.killAllForTask(taskId);
    await patchTask(taskId, {
      closedTerminals: taskById(taskId).terminals,
      terminals: [],
    });
  };

  /** The `task.finished` event of a Finish, single repo or per workspace. */
  const reportFinished = (
    task: Task,
    options: FinishOptions,
    counts: { workspaces: number; prs: number; dropped: number },
  ) =>
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
        ...counts,
      },
    );

  /** The one usage write per task once it is done, as it was before #48. */
  const syncUsageOnFinish = async (
    taskId: string,
    options: FinishOptions,
    killedTerminals: boolean,
  ) => {
    if (!(options.syncUsage && writeCost())) return;
    // Set once the write failed (a failed result may carry no text).
    let error: string | null | undefined;
    try {
      if (killedTerminals && s.finishFlushMs > 0)
        await new Promise((r) => setTimeout(r, s.finishFlushMs));
      await s.copilot.poll();
      const result = await usageSync.syncTask(taskId, {
        comment: true,
        refreshFields: true,
      });
      tel.event('usage.synced', { ok: result.ok, onFinish: true });
      if (!result.ok) error = result.error;
    } catch (e) {
      error = errorMessage(e);
    }
    if (error !== undefined)
      s.broadcast('notice', {
        level: 'warn',
        message: `Task finished, but the AI usage could not be written to the work item: ${error}. Use Sync now on the Usage screen to retry.`,
      });
  };

  /**
   * What follows a successful Finish, single repo or per workspace, once per Finish: the time chosen on the Time
   * spent step is booked, then the usage is written.
   */
  const afterFinish = async (
    taskId: string,
    options: FinishOptions,
    killedTerminals: boolean,
  ) => {
    const booked = options.bookedSeconds;
    if (typeof booked === 'number' && Number.isFinite(booked) && booked >= 0)
      await bookTime(taskId, booked);
    await syncUsageOnFinish(taskId, options, killedTerminals);
  };

  /**
   * Finish for a task with several repos: per workspace (home first) the summary, then its push or PR. Any
   * failure leaves the task ready with every worktree in place, and a retry skips what already succeeded
   * (pushed branches are not pushed again, an existing PR is linked). Then cleanup per workspace, with
   * dropped ones always removed. Workspaces whose folder is gone, or that the request does not name, are
   * left alone.
   */
  const finishWorkspaces = async (
    taskId: string,
    options: FinishOptions,
    wanted: { workspaceId: string; action: WorkspaceAction }[],
  ) => {
    claim(taskId, ['ready'], 'finish');
    // PRs the previous attempt of this Finish made or linked; a retry keeps those instead of looking again.
    const madeBefore = new Map(
      (finishResults.get(taskId) ?? [])
        .filter((r) => r.ok && r.pullRequest)
        .map((r) => [r.workspaceId, r.pullRequest!.id]),
    );
    finishResults.delete(taskId);
    try {
      const task = taskById(taskId);
      // A worktree on another branch (a long-lived `dev` joined by hand) is not the task's to remove.
      for (const r of wanted) {
        if (r.action !== 'drop') continue;
        const w = taskWorkspaces(task).find((x) => x.id === r.workspaceId);
        if (w && !ownBranch(task, w))
          throw new Error(
            `${s.repos.list().find((x) => x.id === w.repoId)?.name ?? w.repoId} is not on this task's branch (${w.branch}): it is kept as is`,
          );
      }
      await patchTask(taskId, { status: 'finishing' });
      type Row = {
        w: WorkspaceView;
        action: WorkspaceAction;
        repoName: string;
        repoPath: string;
        summary: TaskSummary | null;
      };
      const rows: Row[] = [];
      try {
        const actionOf = new Map(wanted.map((r) => [r.workspaceId, r.action]));
        for (const w of activeWorkspaces(task)) {
          const action = actionOf.get(w.id);
          if (!action || !(await pathExists(w.worktreePath))) continue;
          const repo = s.repos.get(w.repoId);
          const summary = await summaryOf(w);
          rows.push({
            w,
            action,
            repoName: repo.name,
            repoPath: repo.path,
            summary,
          });
        }
        const withChanges = rows.filter(
          (r) => r.action !== 'drop' && (r.summary?.commitCount ?? 1) > 0,
        ).length;
        const costScope = withChanges > 1 ? { repos: withChanges } : undefined;
        const failures: string[] = [];
        const results: FinishRowResult[] = [];
        for (const r of rows) {
          const result: FinishRowResult = {
            workspaceId: r.w.id,
            action: r.action,
            ok: true,
            pushed: false,
            pullRequest: null,
            error: null,
          };
          results.push(result);
          const fail = (error: string, text: string) => {
            result.ok = false;
            result.error = error;
            failures.push(text);
          };
          if (r.action === 'drop') {
            // The page judged "no changes" when it loaded; Claude may have worked since. Never force-remove work.
            const files = await s.git
              .summary(r.w.worktreePath, r.w.baseRef)
              .then((x) => x.files)
              .catch(() => null);
            const changed =
              !r.summary ||
              !r.summary.baseKnown ||
              r.summary.commitCount > 0 ||
              files === null ||
              files.length > 0;
            if (changed) {
              const error = `${r.repoName} has changes now; reload Finish`;
              fail(error, `Not removed: ${error}`);
            }
          } else if (r.action === 'push') {
            try {
              r.summary = await pushIfNeeded(r.w, r.summary);
              result.pushed = true;
            } catch (e) {
              const message = errorMessage(e);
              tel.event('pr.failed', { kind: 'git' });
              if (e instanceof GitAuthError) result.auth = e.hint;
              fail(message, `Branch not pushed for ${r.repoName}: ${message}`);
            }
          } else if (r.action === 'pr') {
            try {
              const stored = r.w.pullRequest;
              if (stored && madeBefore.get(r.w.id) === stored.id) {
                // The attempt just before this retry made or linked it: keep it, even if completed or abandoned since.
                r.summary = await pushIfNeeded(r.w, r.summary);
                result.pullRequest = {
                  id: stored.id,
                  url: stored.url,
                  linked: true,
                };
              } else {
                const pr = await openPullRequest(
                  task,
                  r.w,
                  r.summary,
                  costScope,
                );
                r.summary = pr.summary;
                await patchWorkspace(taskId, r.w.id, { pullRequest: pr.ref });
                void s.openExternal(pr.ref.url).catch(() => undefined);
                result.pullRequest = {
                  id: pr.ref.id,
                  url: pr.ref.url,
                  linked: pr.existed,
                };
              }
              result.pushed = true;
            } catch (e) {
              const message = errorMessage(e);
              tel.event('pr.failed', {
                kind: e instanceof AdoError ? e.kind : 'git',
              });
              if (e instanceof GitAuthError) result.auth = e.hint;
              fail(
                message,
                `Pull request not created for ${r.repoName}: ${message}`,
              );
            }
          }
        }
        finishResults.set(taskId, results);
        if (failures.length > 0) throw new Error(failures.join('; '));

        // Summaries first: a cleanup that fails midway must not lose what the branches did.
        await s.store.update((st) => {
          const t = st.tasks.find((x) => x.id === taskId);
          if (!t) return;
          for (const r of rows)
            if (r.action !== 'drop')
              setWorkspace(t, r.w.id, { summary: r.summary });
        });

        const dropping = rows.some((r) => r.action === 'drop');
        // As for a single repo: removing a worktree closes the terminals, which would block it on Windows.
        const killTerminals =
          options.closeTerminals || options.removeWorktree || dropping;
        if (killTerminals) await closeTaskTerminals(taskId);
        for (const r of rows) {
          // Never cleaned up: neither its worktree nor its branch belongs to this task.
          if (!ownBranch(task, r.w)) continue;
          const drop = r.action === 'drop';
          if (
            (options.removeWorktree || drop) &&
            (await pathExists(r.w.worktreePath))
          )
            await s.git.worktreeRemove(r.repoPath, r.w.worktreePath, true);
          if (options.deleteBranch || drop) {
            // A deleted folder leaves a stale registration that blocks branch deletion.
            await s.git.worktreePrune(r.repoPath);
            await s.git.deleteBranch(r.repoPath, r.w.branch);
          }
          if (drop) await patchWorkspace(taskId, r.w.id, { dropped: true });
        }
        const finishedAt = new Date().toISOString();
        await patchTask(taskId, {
          status: 'done',
          finishedAt,
          openPeriods: withPeriodClosed(taskById(taskId), finishedAt),
        });
        reportFinished(task, options, {
          workspaces: rows.length,
          prs: rows.filter((r) => r.action === 'pr').length,
          dropped: rows.filter((r) => r.action === 'drop').length,
        });
        // A later Finish (after Reopen) is a new one, not a retry of this.
        finishResults.delete(taskId);
        await afterFinish(taskId, options, killTerminals);
      } catch (e) {
        if (taskById(taskId).status === 'finishing')
          await patchTask(taskId, { status: 'ready' });
        throw e;
      }
    } finally {
      release(taskId);
    }
  };

  return {
    ...createDocsHandlers({
      taskById,
      git: s.git,
      openFile: (ws, abs, line, col) =>
        editors.openFile(ws.repoId, ws.worktreePath, abs, line, col),
      openExternal: s.openExternal,
      openPath: s.openPath ?? (async () => ''),
      grantView:
        s.grantView ??
        (() => {
          throw new Error('HTML files cannot be shown here');
        }),
      revealFile: s.revealFile ?? (() => undefined),
      watcher: docsWatcher,
      session: sessionDocs,
      event: (n, p) => tel.event(n, p),
    }),
    ...createEditorHandlers({
      taskById,
      editors,
      showFolder: async (p) => {
        const error = await (s.openPath ?? (async () => ''))(p);
        if (error) throw new Error(`Could not open the folder: ${error}`);
      },
    }),
    ...createReviewHandlers({ taskById, review, docsWatcher, gitDirWatcher }),
    'attention:view': async (view) => s.attention?.setView(view),
    'attention:get': async () => s.attention?.snapshot() ?? {},
    ...createTimeHandlers({
      time: s.time,
      tasks: () => s.store.state.tasks,
      task: taskById,
      settings: () => s.settings.get(),
      connectionOf: (task) => taskConnectionId(task, s.repos.list()),
      tracker: s.tracker,
    }),
    'repos:list': async () => s.repos.list(),
    'repos:inspect': async (folder) => {
      const r = await inspectRepo(folder, {
        git: s.git,
        connections: s.connections.list(),
      });
      tel.event('repo.inspected', {
        remote: r.remote?.provider ?? 'none',
        linked: r.remote?.connectionId != null,
        lockfile: r.facts.lockfile ?? 'none',
        dotnet: r.facts.dotnet.length > 0,
        devScript: r.facts.devScript !== null,
        apm: r.facts.apm,
        existingConfig: r.facts.existing !== null,
      });
      return r;
    },
    'repos:add': async (folder, options) => {
      const linked = options?.connectionId
        ? s.connections.list().find((c) => c.id === options.connectionId)
        : undefined;
      // A new repo starts with its connection's on-start options; Settings stays the place to change them.
      const repo = await s.repos.add(folder, {
        ...options,
        workItemOnStart: linked?.workItemOnStart,
      });
      reposChanged();
      tel.event('repo.added', {
        repos: s.repos.list().length,
        wroteConfig: options?.writeConfig !== undefined,
      });
      return repo;
    },
    'repos:remove': async (id) => {
      await s.repos.remove(id);
      reposChanged();
      tel.event('repo.removed');
    },
    'repos:refresh': async (id) => {
      const repo = await s.repos.refresh(id);
      reposChanged();
      return repo;
    },
    'repos:pickFolder': () => s.pickFolder(),
    'agents:detect': async (force) => {
      if (!force && agentsCache) return agentsCache;
      const result = await detectAgents(s.platform, s.runProbe ?? runProbe);
      agentsCache = result;
      tel.event('agents.detected', {
        claude: result.agents.claude.found,
        copilot: result.agents.copilot.found,
        opencode: result.agents.opencode.found,
      });
      return result;
    },
    'repos:config': async (repoId) => {
      const repo = s.repos.get(repoId);
      const config = await s.loadConfig(repo.path);
      return {
        // A repo kept in Shellie only (no file) starts from the base branch it was added with, not the built-in `main`.
        config: config.found ? config : { ...config, base: repo.baseBranch },
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
      if (await pathExists(worktreePath))
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
      const createdAt = new Date().toISOString();
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
          openOpencode: input.openOpencode ?? false,
        },
        terminals: [],
        createdAt,
        finishedAt: null,
        usageSyncedAt: null,
        usageSyncError: null,
        usageCommentId: null,
        summary: null,
        pullRequest: null,
        closedTerminals: [],
        reopen: null,
        extraWorkspaces: [],
        detachedPaths: [],
        homeDropped: false,
        connectionId: repo.connectionId,
        mainCheckoutEdits: [],
        openPeriods: [{ start: createdAt, end: null }],
        time: null,
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
      void recordBaseline(task);
      tel.event('task.created', {
        workItem: input.workItem !== null && input.workItem !== undefined,
        copy: input.copy,
        startClaude: input.startClaude,
        openShell: input.openShell,
        openCopilot: input.openCopilot ?? false,
        openOpencode: input.openOpencode ?? false,
        commands: input.commands.length,
      });
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
      tel.event('setup.retried');
    },
    'tasks:cancelSetup': async (taskId) => {
      claim(taskId, ['setup-failed'], 'cancel the setup of');
      try {
        const task = taskById(taskId);
        const repo = s.repos.get(task.repoId);
        // Windows will not remove a folder that a running process has as its cwd.
        docsWatcher.stopTask(taskId);
        gitDirWatcher.stopTask(taskId);
        await s.terminals.killAllForTask(taskId);
        if (isReopening(task)) {
          // A failed reopen goes back to Done; the task, its branches and its history stay. Only the worktrees
          // this reopen made are removed: a kept one stays as it was.
          const remade = [
            ...(task.reopen
              ? [{ repoPath: repo.path, worktreePath: task.worktreePath }]
              : []),
            ...task.extraWorkspaces
              .filter((w) => !w.dropped && w.reopen !== null)
              .map((w) => ({
                repoPath: s.repos.get(w.repoId).path,
                worktreePath: w.worktreePath,
              })),
          ];
          for (const r of remade) {
            if (await pathExists(r.worktreePath))
              await s.git.worktreeRemove(r.repoPath, r.worktreePath, true);
            await s.git.worktreePrune(r.repoPath);
          }
          setupStates.delete(taskId);
          await endReopen(taskId, {
            status: 'done',
            terminals: [],
            openPeriods: withPeriodClosed(task, new Date().toISOString()),
          });
          tel.event('task.reopenCancelled');
          return;
        }
        if (await pathExists(task.worktreePath))
          await s.git.worktreeRemove(repo.path, task.worktreePath, true);
        await s.git.worktreePrune(repo.path);
        if (await s.git.branchExists(repo.path, task.branch))
          await s.git.deleteBranch(repo.path, task.branch);
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
    'tasks:gitSummary': async (taskId, workspaceId) => {
      const w = workspaceById(taskById(taskId), workspaceId);
      return s.git.summary(w.worktreePath, w.baseRef);
    },
    'tasks:finishChecks': async (taskId) => {
      // A scan error must never keep the user from finishing.
      await workspaces.scan(taskId).catch(() => undefined);
      const task = taskById(taskId);
      const homeSummary = s.git.summary(task.worktreePath, task.baseRef);
      const [checks, home] = await Promise.all([
        Promise.all(activeWorkspaces(task).map((w) => workspaceCheck(task, w))),
        // The home's own fields, as before #48; with other repos in the task a missing home must not fail the page.
        task.extraWorkspaces.length === 0
          ? homeSummary
          : homeSummary.catch(() => ({ files: [], ahead: 0 })),
      ]);
      return {
        uncommitted: home.files,
        unpushed: home.ahead,
        runningTerminals: s.terminals.runningCount(taskId),
        workspaces: checks,
      };
    },
    'tasks:finishResults': async (taskId) => finishResults.get(taskId) ?? null,
    'tasks:reopen': async (taskId) => {
      claim(taskId, ['done'], 'reopen');
      let setup = false;
      try {
        const task = taskById(taskId);
        const active = activeWorkspaces(task);
        if (active.length === 0)
          throw new Error(
            'Nothing to reopen: every repo of this task was removed without changes',
          );
        // Per workspace still in the task: kept (folder there) or to be made again, and from where.
        const restores = new Map<string, { from: string | null }>();
        // Folders an earlier cleanup could not finish (#87): no .git any more, so not a worktree.
        const leftovers: { repoPath: string; path: string }[] = [];
        let via: string | null = null;
        for (const w of active) {
          const repoPath = () => s.repos.get(w.repoId).path;
          if (
            (await pathExists(w.worktreePath)) &&
            !(await pathExists(path.join(w.worktreePath, '.git')))
          )
            leftovers.push({ repoPath: repoPath(), path: w.worktreePath });
          else if (await pathExists(w.worktreePath)) {
            // A kept worktree is used as it is; the home's branch must still be there, as before #48.
            if (
              w.id === HOME_ID &&
              !(await s.git.branchExists(repoPath(), w.branch))
            )
              throw new Error(
                `${w.worktreePath} exists but branch ${w.branch} is gone`,
              );
            continue;
          }
          const source = await restoreSource(repoPath(), w);
          restores.set(w.id, { from: source.from });
          via ??= source.via;
        }
        // Only once every branch can be restored: the leftovers go, so the worktrees can be made again.
        for (const l of leftovers)
          await s.git.worktreeRemove(l.repoPath, l.path, true).catch((e) => {
            throw new Error(
              `${l.path} is left over from an earlier cleanup and could not be deleted (${errorMessage(e)}). Delete it and reopen again.`,
            );
          });
        if (restores.size === 0) {
          // Every worktree was kept: back to ready with the tabs it had.
          const defs =
            task.terminals.length > 0
              ? withoutSetupTab(task.terminals)
              : restoredTerminals(task);
          await patchTask(taskId, {
            status: 'ready',
            finishedAt: null,
            terminals: defs,
            closedTerminals: [],
            openPeriods: withOpenPeriod(task),
          });
          startRestored(taskById(taskId), defs);
          tel.event('task.reopened', { from: 'folder' });
          return { setup: false };
        }
        await mutateTask(taskId, (t) => {
          t.status = 'setting-up';
          t.terminals = [];
          t.openPeriods = withOpenPeriod(task);
          t.reopen = restores.get(HOME_ID) ?? null;
          for (const w of t.extraWorkspaces)
            w.reopen = restores.get(w.id) ?? null;
        });
        setup = true;
        startSetupInBackground(taskId);
        tel.event('task.reopened', { from: via ?? 'branch' });
        return { setup: true };
      } finally {
        // The setup releases the task when it ends.
        if (!setup) release(taskId);
      }
    },
    'tasks:finish': async (taskId, options) => {
      if (options.workspaces)
        return finishWorkspaces(taskId, options, options.workspaces);
      claim(taskId, ['ready'], 'finish');
      try {
        const task = taskById(taskId);
        const repo = s.repos.get(task.repoId);
        await patchTask(taskId, { status: 'finishing' });
        // Record what the branch did while the worktree still exists; a summary must never block Finish.
        let summary: TaskSummary | null = null;
        if (await pathExists(task.worktreePath))
          summary = await summaryOf(task);
        // Push and open the PR before any cleanup: a failure leaves the task ready with its worktree.
        if (options.createPullRequest) {
          let pullRequest: PullRequestRef;
          try {
            const c = await prContext(task);
            if (
              !c.availability.available ||
              !c.availability.target ||
              !c.connection
            )
              throw new Error(
                c.availability.reason ?? 'pull requests are not available',
              );
            const connection = c.connection;
            const { project, repo: repoName } = c.availability.target;
            await s.git.push(task.worktreePath, 'origin', task.branch);
            // The summary was taken before this push; the Done page would otherwise say "local only".
            if (summary)
              summary = {
                ...summary,
                pushed: true,
                upstream: `origin/${task.branch}`,
              };
            const client = s.trackers.tracker(connection.id);
            const repositoryId = await client.repositoryId(project, repoName);
            const existing = await client.findActivePullRequest(
              project,
              repositoryId,
              task.branch,
            );
            const raw =
              existing ??
              (await client.createPullRequest(project, repositoryId, {
                source: task.branch,
                target: c.target,
                title: prTitle(task),
                description: prDescription({
                  heading: task.workItem
                    ? `${task.workItem.type} ${task.workItem.id}: ${task.workItem.title}`
                    : task.name,
                  commits: summary?.commits ?? [],
                  commitCount: summary?.commitCount ?? 0,
                  costLine: costLineFor(taskId),
                }),
                workItemId: task.workItem ? Number(task.workItem.id) : null,
              }));
            pullRequest = {
              id: raw.pullRequestId,
              url: prWebUrl(
                connection.organizationUrl,
                project,
                repoName,
                raw.pullRequestId,
              ),
              repositoryId,
              project,
              repo: repoName,
              status: raw.status,
              isDraft: raw.isDraft,
            };
            await patchTask(taskId, { pullRequest });
            tel.event(existing ? 'pr.linked' : 'pr.created');
          } catch (e) {
            await patchTask(taskId, { status: 'ready' });
            const message = errorMessage(e);
            tel.event('pr.failed', {
              kind: e instanceof AdoError ? e.kind : 'git',
            });
            throw new Error(`Pull request not created: ${message}`);
          }
          void s.openExternal(pullRequest.url).catch(() => undefined);
        }
        // A terminal running in the folder blocks its removal on Windows (and a terminal without its
        // folder is useless), so removing the worktree closes the terminals even when that was unticked.
        const killTerminals = options.closeTerminals || options.removeWorktree;
        try {
          if (killTerminals) await closeTaskTerminals(taskId);
          if (options.removeWorktree && (await pathExists(task.worktreePath)))
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
        const finishedAt = new Date().toISOString();
        await patchTask(taskId, {
          status: 'done',
          finishedAt,
          summary,
          openPeriods: withPeriodClosed(taskById(taskId), finishedAt),
        });
        reportFinished(task, options, {
          workspaces: 1,
          prs: options.createPullRequest ? 1 : 0,
          dropped: 0,
        });
        await afterFinish(taskId, options, killTerminals);
      } finally {
        release(taskId);
      }
    },
    'tasks:openInEditor': async (taskId, workspaceId) => {
      const ws = workspaceById(taskById(taskId), workspaceId);
      await editors.openFolder(ws.repoId, ws.worktreePath);
    },

    'terminals:open': async (taskId, def) => {
      claim(taskId, ['ready'], 'open a terminal in');
      let full: TerminalDef;
      try {
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
    'terminals:write': async (id, data) => {
      s.terminals.write(id, data);
      s.onTerminalInput?.(id, data);
    },
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
    'terminals:restart': async (id, options = {}) => {
      const owner = s.store.state.tasks.find((t) =>
        t.terminals.some((x) => x.id === id),
      );
      const def = owner?.terminals.find((x) => x.id === id);
      const known = s.terminals.has(id);
      // Claude Code resumes its conversation instead of starting a new one. OpenCode gets its env built again, so
      // a start without the project config (#109) lasts until the next Restart only.
      if (known && def?.kind !== 'claude' && def?.kind !== 'opencode') {
        s.terminalFailures?.clear(id);
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
      const skipConfig =
        def.kind === 'opencode' && options.withoutProjectConfig === true;
      spawnTerminal(
        owner,
        def,
        def.kind === 'claude',
        skipConfig ? { OPENCODE_DISABLE_PROJECT_CONFIG: '1' } : {},
      );
      tel.event('terminal.restarted', {
        kind: def.kind,
        afterRelaunch: !known,
        ...(skipConfig ? { withoutProjectConfig: true } : {}),
      });
    },
    'terminals:failure': async (id) => s.terminalFailures?.get(id) ?? null,
    'terminals:buffer': async (id) => s.terminals.buffer(id),
    'terminals:isRunning': async (id) => s.terminals.isRunning(id),
    'terminals:reportScheme': async (id, scheme) =>
      s.terminals.reportScheme(id, scheme === 'dark' ? 'dark' : 'light'),
    'connections:list': async () => s.connections.list(),
    'connections:save': saveConnection,
    'connections:probe': async (input) => {
      // A stored token only ever goes to its own organization, whatever URL came with it.
      const organizationUrl = input.connectionId
        ? s.connections.get(input.connectionId).organizationUrl
        : s.connections.normalizeUrl(input.organizationUrl);
      const pat = input.connectionId
        ? await s.connections.token(input.connectionId)
        : (input.pat ?? '').trim();
      if (!pat) throw new Error('Enter a personal access token');
      const client = new AdoClient(organizationUrl, async () => pat);
      try {
        const who = await client.whoAmI();
        let projects: { id: string; name: string }[] = [];
        let canListProjects = true;
        try {
          projects = await client.projects();
        } catch (e) {
          if (
            !(e instanceof AdoError && (e.status === 401 || e.status === 403))
          )
            throw e;
          canListProjects = false;
        }
        return { ...who, projects, canListProjects };
      } catch (e) {
        tel.event('connection.probeFailed', {
          status: e instanceof AdoError ? (e.status ?? 0) : 0,
        });
        throw e;
      }
    },
    'connections:saveMany': async (input) => {
      const organizationUrl = input.connectionId
        ? s.connections.get(input.connectionId).organizationUrl
        : s.connections.normalizeUrl(input.organizationUrl);
      const pat = input.connectionId
        ? await s.connections.token(input.connectionId)
        : (input.pat ?? '');
      const known = new Set(
        s.connections
          .list()
          .filter((c) => c.organizationUrl === organizationUrl)
          .map((c) => c.project.toLowerCase()),
      );
      const saved: Connection[] = [];
      for (const raw of input.projects) {
        const project = raw.trim();
        if (!project || known.has(project.toLowerCase())) continue;
        known.add(project.toLowerCase());
        saved.push(
          await saveConnection({
            organizationUrl,
            project,
            pat,
            provider: input.provider,
            workItemOnStart: input.workItemOnStart,
          }),
        );
      }
      return saved;
    },
    'connections:remove': async (id) => {
      s.connections.get(id);
      for (const r of s.repos.list())
        if (r.connectionId === id) await s.repos.setConnection(r.id, null);
      await s.connections.remove(id);
      s.trackers.invalidate(id);
      dropTypes(id);
      connectionsChanged();
      reposChanged();
      tel.event('connection.removed');
    },
    'connections:verify': async (id) => verifyConnection(id),
    'repos:setConnection': async (repoId, connectionId) => {
      if (connectionId !== null) s.connections.get(connectionId);
      const repo = await s.repos.setConnection(repoId, connectionId);
      reposChanged();
      tel.event('repo.connectionLinked', { linked: connectionId !== null });
      return repo;
    },
    'repos:setWorkItemOnStart': async (repoId, settings) => {
      const repo = await s.repos.setWorkItemOnStart(repoId, settings);
      reposChanged();
      return repo;
    },
    'repos:setDiscovered': async (repoId, discovered) => {
      const repo = await s.repos.setDiscovered(repoId, discovered);
      reposChanged();
      return repo;
    },
    'tasks:scanWorkspaces': async (taskId) => {
      // Finish, setup and Reopen work from the task's workspace list; it must not change under them.
      if (taskById(taskId).status !== 'ready') return [];
      const before = JSON.stringify(taskById(taskId).mainCheckoutEdits);
      const { added } = await workspaces.scan(taskId);
      if (added.length > 0) reposChanged();
      if (
        added.length > 0 ||
        JSON.stringify(taskById(taskId).mainCheckoutEdits) !== before
      )
        await tasksChanged();
      return added;
    },
    'tasks:addWorkspace': async (taskId, folder) => {
      const added = await workspaces.add(taskId, folder);
      reposChanged();
      await tasksChanged();
      return added;
    },
    'tasks:removeWorkspace': async (taskId, workspaceId) => {
      await workspaces.remove(taskId, workspaceId);
      await tasksChanged();
    },
    'tasks:prAvailability': async (taskId, workspaceId) => {
      const task = taskById(taskId);
      const c = await prContext(
        task,
        workspaceId === undefined
          ? undefined
          : workspaceById(task, workspaceId),
      );
      return {
        available: c.availability.available,
        reason: c.availability.reason,
        target: c.availability.available ? c.target : null,
      };
    },
    'tasks:prStatus': async (taskId, workspaceId) => {
      const task = taskById(taskId);
      const w = workspaceById(task, workspaceId);
      const pr = w.pullRequest;
      if (!pr) return null;
      // The PR was created through the workspace's own repo connection (maybe another org than the task's).
      const connectionId =
        s.repos.list().find((r) => r.id === w.repoId)?.connectionId ??
        taskConnectionId(task, s.repos.list());
      if (!connectionId) return pr;
      try {
        const raw = await s.trackers
          .tracker(connectionId)
          .pullRequest(pr.project, pr.repositoryId, pr.id);
        const next = { ...pr, status: raw.status, isDraft: raw.isDraft };
        await patchWorkspace(taskId, w.id, { pullRequest: next });
        return next;
      } catch {
        return pr;
      }
    },
    'workItems:currentIteration': async (connectionId) => {
      const c = s.connections.get(connectionId);
      return withConnection(connectionId, () =>
        s.trackers.tracker(connectionId).currentIteration(c.project),
      );
    },
    'workItems:search': async (connectionId, search) => {
      const c = s.connections.get(connectionId);
      tel.event('workItems.search', {
        scope: search.scope,
        hasText: search.text.trim().length > 0,
      });
      return withConnection(connectionId, async () => {
        const client = s.trackers.tracker(connectionId);
        const iteration =
          search.scope === 'sprint'
            ? await client.currentIteration(c.project)
            : null;
        if (search.scope === 'sprint' && !iteration) return [];
        return client.searchItems({
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
        s.trackers.tracker(connectionId).iteration(c.project),
      );
    },
    'workItems:types': async (connectionId) => {
      const c = s.connections.get(connectionId);
      let hit = typesCache.get(connectionId);
      if (!hit) {
        const client = s.trackers.tracker(connectionId);
        hit = withConnection(connectionId, () =>
          client.itemTypes(c.project),
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
        s.trackers.tracker(connectionId).items(c.project, [n]),
      );
      return item ?? null;
    },
    'shell:openExternal': async (url) => {
      if (!allowedExternal(url))
        throw new Error(`Opening ${url} is not allowed`);
      await s.openExternal(url);
    },

    'time:sync': async (taskId) => {
      if (!writeTime())
        throw new Error(
          'Writing time to Azure DevOps is off. Turn it on in Settings.',
        );
      const task = taskById(taskId);
      if (task.status !== 'done' || !task.time)
        throw new Error('Only a finished task with booked time can be written');
      const error = await syncTime(taskId);
      if (error) throw new Error(error);
    },
    'budget:get': async (monthOffset) => {
      if (!s.budget) throw new Error('Budget is not available');
      return s.budget.view(monthOffset);
    },
    'home:get': () => home.get(),
    'home:refresh': () => home.refresh(),
    'home:stats': async (period) =>
      homeStats({
        period,
        now: new Date(),
        tasks: s.store.state.tasks,
        repos: s.repos.list(),
        usage: s.usage,
        time: s.time,
      }),
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
      if (saved.theme !== before.theme) s.applyTheme?.(saved.theme);
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
      void s.budget?.pass().catch(() => undefined);
      s.broadcast('budget:changed', {});
      return saved;
    },
  };
}
