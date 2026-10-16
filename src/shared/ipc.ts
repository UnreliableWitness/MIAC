import type {
  Connection,
  ConnectionInput,
  CreateTaskInput,
  FinishChecks,
  FinishOptions,
  GitSummary,
  Iteration,
  MiacConfig,
  PullRequestRef,
  DocFile,
  NewTerminal,
  Repo,
  SetupEvent,
  StartSettings,
  SetupState,
  Sprint,
  Task,
  TaskView,
  TerminalDef,
  WorkItemSearch,
  WorkItemSummary,
  WorkItemTypeMeta,
} from './types';
import type {
  AppSettings,
  FieldsStatus,
  Rate,
  ReceiverStatus,
  SyncResult,
  TaskUsage,
} from './usage';
import type { RendererTelemetry } from './telemetry';

/** Request/response channels. `args` is the tuple the renderer passes; `result` is what main resolves. */
export type Channels = {
  'repos:list': { args: []; result: Repo[] };
  'repos:add': { args: [folder: string]; result: Repo };
  'repos:remove': { args: [id: string]; result: void };
  'repos:refresh': { args: [id: string]; result: Repo };
  'repos:pickFolder': { args: []; result: string | null };
  'repos:config': {
    args: [repoId: string];
    result: { config: MiacConfig; worktreeRoot: string };
  };
  'connections:list': { args: []; result: Connection[] };
  'connections:save': { args: [input: ConnectionInput]; result: Connection };
  'connections:remove': { args: [id: string]; result: void };
  'connections:verify': { args: [id: string]; result: Connection };
  'repos:setConnection': {
    args: [repoId: string, connectionId: string | null];
    result: Repo;
  };
  'repos:setWorkItemOnStart': {
    args: [repoId: string, settings: StartSettings];
    result: Repo;
  };
  'tasks:prAvailability': {
    args: [taskId: string];
    result: {
      available: boolean;
      reason: string | null;
      target: string | null;
    };
  };
  'tasks:prStatus': { args: [taskId: string]; result: PullRequestRef | null };
  'workItems:currentIteration': {
    args: [connectionId: string];
    result: Iteration | null;
  };
  'workItems:search': {
    args: [connectionId: string, search: WorkItemSearch];
    result: WorkItemSummary[];
  };
  /** The current sprint in backlog order, or `iteration: null` when the project has none. */
  'workItems:sprint': { args: [connectionId: string]; result: Sprint };
  /** The project's work item types with icons as data URLs and state colors; cached in main for the session. */
  'workItems:types': {
    args: [connectionId: string];
    result: WorkItemTypeMeta[];
  };
  /** One work item, live; null when it is gone or unreadable. */
  'workItems:get': {
    args: [connectionId: string, id: string];
    result: WorkItemSummary | null;
  };
  'shell:openExternal': { args: [url: string]; result: void };
  'docs:list': { args: [taskId: string]; result: { files: DocFile[] } };
  'docs:read': {
    args: [taskId: string, path: string];
    result: { text: string; mtimeMs: number };
  };
  'docs:asset': { args: [taskId: string, path: string]; result: string };
  'docs:resolve': {
    args: [taskId: string, path: string];
    result: { path: string; kind: 'md' | 'file' } | null;
  };
  'docs:openInEditor': {
    args: [taskId: string, path: string, line?: number, col?: number];
    result: void;
  };
  'docs:reveal': { args: [taskId: string, path: string]; result: void };
  'docs:watch': {
    args: [taskId: string, on: boolean];
    result: { live: boolean };
  };
  'links:open': { args: [url: string]; result: void };
  'tasks:list': { args: []; result: TaskView[] };
  'tasks:create': { args: [input: CreateTaskInput]; result: Task };
  'tasks:setupState': { args: [taskId: string]; result: SetupState | null };
  'tasks:retrySetup': { args: [taskId: string]; result: void };
  'tasks:cancelSetup': { args: [taskId: string]; result: void };
  'tasks:gitSummary': { args: [taskId: string]; result: GitSummary };
  'tasks:finishChecks': { args: [taskId: string]; result: FinishChecks };
  'tasks:finish': {
    args: [taskId: string, options: FinishOptions];
    result: void;
  };
  'tasks:openInEditor': { args: [taskId: string]; result: void };
  'terminals:open': {
    args: [taskId: string, def: NewTerminal];
    result: TerminalDef;
  };
  'terminals:write': { args: [id: string, data: string]; result: void };
  'terminals:resize': {
    args: [id: string, cols: number, rows: number];
    result: void;
  };
  'terminals:kill': { args: [id: string]; result: void };
  'terminals:restart': { args: [id: string]; result: void };
  'terminals:buffer': { args: [id: string]; result: string };
  'terminals:isRunning': { args: [id: string]; result: boolean };
  'usage:task': { args: [taskId: string]; result: TaskUsage };
  'usage:setBillable': {
    args: [taskId: string, sessionId: string, billable: boolean];
    result: TaskUsage;
  };
  'usage:sync': { args: [taskId: string]; result: SyncResult };
  'usage:exportCsv': { args: [taskId: string]; result: string };
  'usage:fieldsStatus': { args: [connectionId: string]; result: FieldsStatus };
  'usage:receiverStatus': { args: []; result: ReceiverStatus };
  'rates:list': { args: []; result: { rates: Rate[]; officialAsOf: string } };
  /** A downloaded update waiting for a restart; null when there is none (always in dev and on macOS). */
  'update:status': { args: []; result: PendingUpdate | null };
  /** Quits MIAC and starts the downloaded update. */
  'update:install': { args: []; result: void };
  'app:info': {
    args: [];
    /** windowsBuild: the OS build number on Windows (for xterm's ConPTY handling), else null. */
    result: { version: string; windowsBuild: number | null };
  };
  'settings:get': { args: []; result: AppSettings };
  'settings:save': { args: [settings: AppSettings]; result: AppSettings };
};

/** Push events from main to the renderer. */
export type Events = {
  setup: SetupEvent;
  'terminal:data': { id: string; data: string };
  'terminal:exit': { id: string; exitCode: number };
  'tasks:changed': TaskView[];
  'repos:changed': Repo[];
  'connections:changed': Connection[];
  'usage:changed': { taskId: string };
  'usage:receiverStatus': ReceiverStatus;
  'docs:changed': { taskId: string; paths: string[] };
  /** Main stopped a task's watcher (an error, or Finish/Cancel before removing the worktree); Docs tabs poll instead. */
  'docs:watchStopped': { taskId: string };
  notice: { level: 'info' | 'warn' | 'error'; message: string };
  /** An update finished downloading; the renderer offers Restart and update. */
  'update:ready': PendingUpdate;
};

/** `version` is null when the release name holds none. */
export type PendingUpdate = { version: string | null };

export type Handlers = {
  [K in keyof Channels]: (
    ...args: Channels[K]['args']
  ) => Promise<Channels[K]['result']>;
};

export type MiacApi = {
  invoke<K extends keyof Channels>(
    channel: K,
    ...args: Channels[K]['args']
  ): Promise<Channels[K]['result']>;
  on<K extends keyof Events>(
    event: K,
    listener: (payload: Events[K]) => void,
  ): () => void;
  /** Fire-and-forget app telemetry; main validates, scrubs and drops it when the user opted out. */
  track(message: RendererTelemetry): void;
};

export const EVENT_PREFIX = 'miac-event:';
