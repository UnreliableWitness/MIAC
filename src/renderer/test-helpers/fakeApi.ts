import type { Channels, Events, MiacApi } from '../../shared/ipc';

type AnyFn = (...args: never[]) => unknown;
export type FakeHandlers = Partial<{
  [K in keyof Channels]: (
    ...args: Channels[K]['args']
  ) => Channels[K]['result'] | Promise<Channels[K]['result']>;
}>;

const defaults: FakeHandlers = {
  'repos:list': () => [],
  'connections:list': () => [],
  'tasks:list': () => [],
  'tasks:setupState': () => null,
  'terminals:buffer': () => '',
  'terminals:isRunning': () => false,
  'terminals:write': () => undefined,
  'terminals:resize': () => undefined,
};

/** Installs `window.miac` backed by plain functions. Returns the call log and an `emit` to push events. */
export function installFakeApi(overrides: FakeHandlers = {}) {
  const calls: { channel: keyof Channels; args: unknown[] }[] = [];
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
  };
  window.miac = fake;
  const emit = <K extends keyof Events>(event: K, payload: Events[K]) =>
    listeners.get(event)?.forEach((l) => l(payload));
  return { calls, emit };
}
