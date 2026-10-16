import type { TaskTime } from '../../shared/time';
import type { TaskUsage } from '../../shared/usage';
import type { Channels, Events, MiacApi } from '../../shared/ipc';
import type { RendererTelemetry } from '../../shared/telemetry';

type AnyFn = (...args: never[]) => unknown;
export type FakeHandlers = Partial<{
  [K in keyof Channels]: (
    ...args: Channels[K]['args']
  ) => Channels[K]['result'] | Promise<Channels[K]['result']>;
}>;

export const emptyUsage = (taskId: string): TaskUsage => ({
  taskId,
  sessions: [],
  recent: [],
  unpricedRequests: 0,
  usdToEur: 0.92,
  billable: { costUsd: 0, costEur: 0, tokens: 0 },
  byTool: {
    'claude-code': { costUsd: 0, costEur: 0, sessions: 0, tokens: 0 },
    'copilot-cli': { costUsd: 0, costEur: 0, sessions: 0, tokens: 0 },
  },
});

export const emptyTime = (taskId: string): TaskTime => ({
  taskId,
  activeSeconds: 0,
  agentSeconds: { 'claude-code': 0, 'copilot-cli': 0, opencode: 0 },
  realisticSeconds: 0,
  wallClockSeconds: 0,
  measuredSinceReopenSeconds: 0,
  booking: null,
  estimate: null,
});

const defaults: FakeHandlers = {
  'time:focus': () => undefined,
  'time:task': (taskId) => emptyTime(taskId),
  'time:sprint': () => ({}),
  'docs:list': () => ({ files: [] }),
  'docs:watch': () => ({ live: true }),
  'docs:resolve': () => null,
  'settings:get': () => ({
    version: 1,
    receiverPort: 4319,
    hourlySync: true,
    writeTimeToAdo: false,
    idleMinutes: 5,
    workHours: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
    writeCostToAdo: true,
    showSplash: true,
    sendTelemetry: true,
  }),
  'app:info': () => ({ version: '1.0.0', windowsBuild: null }),
  'update:status': () => null,
  'rates:list': () => ({ rates: [], officialAsOf: '2026-10-14' }),
  'usage:task': (taskId) => emptyUsage(taskId),
  'repos:list': () => [],
  'workItems:types': () => [],
  'connections:list': () => [],
  'tasks:list': () => [],
  'tasks:setupState': () => null,
  'tasks:prAvailability': () => ({
    available: false,
    reason: 'origin is not an Azure Repos URL',
    target: null,
  }),
  'tasks:prStatus': () => null,
  'repos:setWorkItemOnStart': (repoId, settings) => ({
    id: repoId,
    name: 'repo',
    path: '/src/repo',
    baseBranch: 'main',
    connectionId: null,
    miacYmlFound: false,
    workItemOnStart: settings,
  }),
  'terminals:buffer': () => '',
  'terminals:isRunning': () => false,
  'terminals:write': () => undefined,
  'terminals:resize': () => undefined,
  'usage:receiverStatus': () => ({
    listening: true,
    port: 4319,
    error: null,
    copilot: { records: 0, unreadable: 0 },
  }),
};

/** Installs `window.miac` backed by plain functions. Returns the call log and an `emit` to push events. */
export function installFakeApi(overrides: FakeHandlers = {}) {
  const calls: { channel: keyof Channels; args: unknown[] }[] = [];
  const tracked: RendererTelemetry[] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const handlers = { ...defaults, ...overrides };
  const fake: MiacApi = {
    invoke: async (channel, ...args) => {
      calls.push({ channel, args });
      const fn = handlers[channel] as AnyFn | undefined;
      if (!fn) throw new Error(`No fake handler for ${channel}`);
      return (await fn(...(args as never[]))) as never;
    },
    on: (event, listener) => {
      const set = listeners.get(event) ?? new Set();
      set.add(listener as (p: unknown) => void);
      listeners.set(event, set);
      return () => set.delete(listener as (p: unknown) => void);
    },
    track: (message) => {
      tracked.push(message);
    },
    titleBar: 'native',
  };
  window.miac = fake;
  const emit = <K extends keyof Events>(event: K, payload: Events[K]) =>
    listeners.get(event)?.forEach((l) => l(payload));
  return { calls, emit, tracked };
}
