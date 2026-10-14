import { describe, expect, it } from 'vitest';
import type { Handlers } from '../../shared/ipc';
import { registerIpc } from './register';

type Fn = (event: never, ...args: unknown[]) => Promise<unknown>;

function fakeIpc() {
  const registered = new Map<string, Fn>();
  return {
    registered,
    ipc: {
      handle(channel: string, fn: Fn) {
        registered.set(channel, fn);
      },
    },
  };
}

describe('registerIpc', () => {
  it('registers every handler under its channel name', () => {
    const { ipc, registered } = fakeIpc();
    const handlers = {
      'repos:list': async () => [],
      'tasks:finish': async () => {},
      'terminals:write': async () => {},
    } as unknown as Handlers;
    registerIpc(ipc, handlers);
    expect([...registered.keys()].sort()).toEqual(Object.keys(handlers).sort());
  });

  it('forwards the arguments without the event and propagates rejections', async () => {
    const { ipc, registered } = fakeIpc();
    const calls: unknown[][] = [];
    const handlers = {
      'terminals:write': async (...args: unknown[]) => {
        calls.push(args);
      },
      'repos:remove': async () => {
        throw new Error('boom');
      },
    } as unknown as Handlers;
    registerIpc(ipc, handlers);
    await registered.get('terminals:write')?.({} as never, 't1', 'ls\r');
    expect(calls).toEqual([['t1', 'ls\r']]);
    await expect(
      registered.get('repos:remove')?.({} as never, 'x'),
    ).rejects.toThrow('boom');
  });
});
