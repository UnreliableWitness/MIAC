import type { IpcMain } from 'electron';
import type { Handlers } from '../../shared/ipc';

/** Registers every handler under its channel name. Errors propagate to the renderer as rejected promises. */
export function registerIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  handlers: Handlers,
): void {
  for (const channel of Object.keys(handlers) as (keyof Handlers)[]) {
    const fn = handlers[channel] as (...args: unknown[]) => Promise<unknown>;
    ipcMain.handle(channel, (_event, ...args: unknown[]) => fn(...args));
  }
}
