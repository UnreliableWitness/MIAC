import { describe, expect, it } from 'vitest';
import type { Handlers } from '../../shared/ipc';
import { registerIpc } from './register';

type Fn = (event: never, ...args: unknown[]) => Promise<unknown>;

const APP = 'file:///app/index.html';
const fromApp = { senderFrame: { url: APP } } as never;
const isApp = (url: string) => url === APP;

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
    registerIpc(ipc, handlers, isApp);
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
    registerIpc(ipc, handlers, isApp);
    await registered.get('terminals:write')?.(fromApp, 't1', 'ls\r');
    expect(calls).toEqual([['t1', 'ls\r']]);
    await expect(
      registered.get('repos:remove')?.(fromApp, 'x'),
    ).rejects.toThrow('boom');
  });

  it('rejects an invoke from a frame that is not the app, without calling the handler', async () => {
    const { ipc, registered } = fakeIpc();
    const calls: unknown[][] = [];
    const handlers = {
      'terminals:write': async (...args: unknown[]) => {
        calls.push(args);
      },
    } as unknown as Handlers;
    registerIpc(ipc, handlers, isApp);
    const write = registered.get('terminals:write')!;
    await expect(
      write(
        { senderFrame: { url: 'https://evil.example/' } } as never,
        't1',
        'rm -rf ~\r',
      ),
    ).rejects.toThrow('IPC from an untrusted page was rejected');
    await expect(
      write({ senderFrame: null } as never, 't1', 'x'),
    ).rejects.toThrow('IPC from an untrusted page was rejected');
    expect(calls).toEqual([]);
  });
});
