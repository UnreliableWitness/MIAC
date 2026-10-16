import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { Handlers } from '../../shared/ipc';
import { trustedSender } from '../windowGuards';

/**
 * Registers every handler under its channel name. Errors propagate to the renderer as rejected promises.
 * An invoke from a frame that is not one of the app's own pages (`isApp`) is rejected without running the handler.
 */
export function registerIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  handlers: Handlers,
  isApp: (url: string) => boolean,
): void {
  for (const channel of Object.keys(handlers) as (keyof Handlers)[]) {
    const fn = handlers[channel] as (...args: unknown[]) => Promise<unknown>;
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args) => {
      if (!trustedSender(event, isApp))
        throw new Error('IPC from an untrusted page was rejected');
      return fn(...args);
    });
  }
}
