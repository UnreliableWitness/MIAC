import type {
  Connection,
  ConnectionInput,
  CreateTaskInput,
  FinishChecks,
  FinishOptions,
  GitSummary,
  Iteration,
  MiacConfig,
  NewTerminal,
  Repo,
  SetupEvent,
  SetupState,
  Task,
  TaskView,
  TerminalDef,
  WorkItemSearch,
  WorkItemSummary,
} from './types';
import type {
  AppSettings,
  FieldsStatus,
  Rate,
  ReceiverStatus,
  SyncResult,
  TaskUsage,
} from './usage';

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
  'workItems:currentIteration': {
    args: [connectionId: string];
    result: Iteration | null;
  };
  'workItems:search': {
    args: [connectionId: string, search: WorkItemSearch];
    result: WorkItemSummary[];
  };
  'shell:openExternal': { args: [url: string]; result: void };
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
  'rates:save': { args: [rates: Rate[]]; result: Rate[] };
  'rates:reset': { args: []; result: Rate[] };
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
  notice: { level: 'info' | 'warn' | 'error'; message: string };
};

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
};

export const EVENT_PREFIX = 'miac-event:';
