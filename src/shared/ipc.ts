import type {
  Connection,
  ConnectionInput,
  CreateTaskInput,
  FinishChecks,
  FinishOptions,
  FinishRowResult,
  GitSummary,
  Iteration,
  ShellieConfig,
  PullRequestRef,
  DocFile,
  NewTerminal,
  Repo,
  SetupEvent,
  StartSettings,
  SetupState,
  Sprint,
  SprintItem,
  Task,
  TaskView,
  TerminalDef,
  WorkItemSearch,
  WorkItemSummary,
  WorkItemTypeMeta,
  Workspace,
} from './types';
import type {
  AppSettings,
  FieldsStatus,
  Rate,
  ReceiverStatus,
  SyncResult,
  TaskUsage,
} from './usage';
import type { EditorChoice, EditorId, EditorOptions } from './editors';
import type { RendererTelemetry } from './telemetry';
import type { TitleBarKind } from './titleBar';
import type { LocalItemTime, TaskTime } from './time';
import type { HomePeriod, HomeSnapshot, HomeStats } from './home';
import type {
  FileContent,
  NewReviewComment,
  ReviewFileRef,
  ReviewFiles,
  ReviewScope,
  ReviewState,
  ReviewSummary,
} from './review';

/** Request/response channels. `args` is the tuple the renderer passes; `result` is what main resolves. */
export type Channels = {
  'repos:list': { args: []; result: Repo[] };
  'repos:add': { args: [folder: string]; result: Repo };
  'repos:remove': { args: [id: string]; result: void };
  'repos:refresh': { args: [id: string]; result: Repo };
  'repos:pickFolder': { args: []; result: string | null };
  'repos:config': {
    args: [repoId: string];
    result: { config: ShellieConfig; worktreeRoot: string };
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
  /** Clearing the mark makes a repo found in a task a normal repo. */
  'repos:setDiscovered': {
    args: [repoId: string, discovered: boolean];
    result: Repo;
  };
  'tasks:prAvailability': {
    args: [taskId: string, workspaceId?: string];
    result: {
      available: boolean;
      reason: string | null;
      target: string | null;
    };
  };
  'tasks:prStatus': {
    args: [taskId: string, workspaceId?: string];
    result: PullRequestRef | null;
  };
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
    result: SprintItem | null;
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
    result: { path: string; kind: 'md' | 'file'; workspaceId?: string } | null;
  };
  /** Installed editors; `refresh` looks again instead of using this launch's cached detection. */
  'editor:installed': { args: [refresh?: boolean]; result: EditorChoice[] };
  'editor:options': {
    args: [taskId: string, workspaceId?: string];
    result: EditorOptions;
  };
  'editor:openFolder': {
    args: [
      taskId: string,
      workspaceId: string | undefined,
      o: { editorId?: EditorId; solution?: string },
    ];
    result: void;
  };
  /** Opens a worktree file (root-relative) at a line in the chosen editor, or in `editorId`. */
  'editor:openFile': {
    args: [
      taskId: string,
      workspaceId: string | undefined,
      path: string,
      line?: number,
      editorId?: EditorId,
    ];
    result: void;
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
  /** Everything the task changed in the scope, per repo; a repo that fails carries `error`. */
  'review:files': {
    args: [taskId: string, scope: ReviewScope];
    result: ReviewFiles;
  };
  'review:file': {
    args: [
      taskId: string,
      workspaceId: string,
      file: ReviewFileRef,
      scope: ReviewScope,
    ];
    result: FileContent;
  };
  /** Viewed files and comments, with comments located again in the current files. */
  'review:state': { args: [taskId: string]; result: ReviewState };
  'review:setViewed': {
    args: [taskId: string, key: string, hash: string | null];
    result: ReviewState;
  };
  'review:addComment': {
    args: [taskId: string, input: NewReviewComment];
    result: ReviewState;
  };
  'review:updateComment': {
    args: [
      taskId: string,
      id: string,
      patch: { text?: string; status?: 'open' | 'resolved' },
    ];
    result: ReviewState;
  };
  'review:deleteComment': {
    args: [taskId: string, id: string];
    result: ReviewState;
  };
  'review:markSent': {
    args: [taskId: string, ids: string[]];
    result: ReviewState;
  };
  'review:summary': { args: [taskId: string]; result: ReviewSummary };
  /** Holds the file and git-dir watchers of one worktree (a docs target); `live` false means poll. */
  'review:watch': {
    args: [target: string, on: boolean];
    result: { live: boolean };
  };
  'tasks:list': { args: []; result: TaskView[] };
  'tasks:create': { args: [input: CreateTaskInput]; result: Task };
  'tasks:setupState': { args: [taskId: string]; result: SetupState | null };
  'tasks:retrySetup': { args: [taskId: string]; result: void };
  'tasks:cancelSetup': { args: [taskId: string]; result: void };
  'tasks:gitSummary': {
    args: [taskId: string, workspaceId?: string];
    result: GitSummary;
  };
  'tasks:finishChecks': { args: [taskId: string]; result: FinishChecks };
  /** Each row's outcome of the last Finish with workspaces (null before one ran); read after a failed Finish. */
  'tasks:finishResults': {
    args: [taskId: string];
    result: FinishRowResult[] | null;
  };
  /** Brings a finished task back: `setup` is true when its worktree is being made again (Setup page). */
  'tasks:reopen': { args: [taskId: string]; result: { setup: boolean } };
  'tasks:finish': {
    args: [taskId: string, options: FinishOptions];
    result: void;
  };
  'tasks:openInEditor': {
    args: [taskId: string, workspaceId?: string];
    result: void;
  };
  /** Looks for other repos' worktrees the task worked in and joins them; returns the ones added. */
  'tasks:scanWorkspaces': { args: [taskId: string]; result: Workspace[] };
  /** Joins the worktree containing a folder by hand. */
  'tasks:addWorkspace': {
    args: [taskId: string, folder: string];
    result: Workspace;
  };
  /** Drops an extra workspace from the task; its worktree and branch stay on disk. */
  'tasks:removeWorkspace': {
    args: [taskId: string, workspaceId: string];
    result: void;
  };
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
  /** The last Home snapshot (from disk at launch), null before the first build. */
  'home:get': { args: []; result: HomeSnapshot | null };
  /** Rebuilds the Home snapshot over every connection, or joins the rebuild already running. */
  'home:refresh': { args: []; result: HomeSnapshot };
  /** The developer's own totals for this week or month, from local data. */
  'home:stats': { args: [period: HomePeriod]; result: HomeStats };
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
  /** Quits Shellie and starts the downloaded update. */
  'update:install': { args: []; result: void };
  'app:info': {
    args: [];
    /** windowsBuild: the OS build number on Windows (for xterm's ConPTY handling), else null. */
    result: { version: string; windowsBuild: number | null };
  };
  'settings:get': { args: []; result: AppSettings };
  'settings:save': { args: [settings: AppSettings]; result: AppSettings };
  /** The task on screen, for active time (null: no task page is showing). */
  'time:focus': { args: [taskId: string | null]; result: void };
  'time:task': { args: [taskId: string]; result: TaskTime };
  /** Writes a done task's booked time to its work item again (Retry on the Done page); throws when time writing is off or the write fails. */
  'time:sync': { args: [taskId: string]; result: void };
  /** The task's time as CSV text. */
  'time:exportCsv': { args: [taskId: string]; result: string };
  /** Local time per work item id, over every task of the item on repos linked to the connection. */
  'time:sprint': {
    args: [connectionId: string];
    result: Record<string, LocalItemTime>;
  };
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
  'time:changed': { taskId: string };
  'usage:receiverStatus': ReceiverStatus;
  'docs:changed': { taskId: string; paths: string[] };
  /** Main stopped a task's watcher (an error, or Finish/Cancel before removing the worktree); Docs tabs poll instead. */
  'docs:watchStopped': { taskId: string };
  /** A worktree's git dir changed (commit, amend, reset, staging); `taskId` is a docs target. */
  'review:changed': { taskId: string };
  notice: { level: 'info' | 'warn' | 'error'; message: string };
  /** An update finished downloading; the renderer offers Restart and update. */
  'update:ready': PendingUpdate;
  /** A Home rebuild finished. */
  'home:updated': HomeSnapshot;
  /** The main window entered or left full screen (also sent on every load). */
  'window:fullScreen': boolean;
};

/** `version` is null when the release name holds none. */
export type PendingUpdate = { version: string | null };

export type Handlers = {
  [K in keyof Channels]: (
    ...args: Channels[K]['args']
  ) => Promise<Channels[K]['result']>;
};

export type ShellieApi = {
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
  /** How the window draws its title bar, so the header keeps room for the window controls (#49). */
  titleBar: TitleBarKind;
};

export const EVENT_PREFIX = 'shellie-event:';
