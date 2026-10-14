import type {
  CreateTaskInput,
  FinishChecks,
  FinishOptions,
  GitSummary,
  MiacConfig,
  NewTerminal,
  Repo,
  SetupEvent,
  SetupState,
  Task,
  TaskView,
  TerminalDef,
} from './types';

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
};

/** Push events from main to the renderer. */
export type Events = {
  setup: SetupEvent;
  'terminal:data': { id: string; data: string };
  'terminal:exit': { id: string; exitCode: number };
  'tasks:changed': TaskView[];
  'repos:changed': Repo[];
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
