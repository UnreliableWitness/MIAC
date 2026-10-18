import type { ShellieApi } from '../shared/ipc';

export function api(): ShellieApi {
  if (!window.shellie)
    throw new Error('window.shellie is not available: preload did not run');
  return window.shellie;
}

/** An IPC rejection's message without Electron's "Error invoking remote method" prefix. */
export function ipcErrorMessage(e: unknown): string {
  return e instanceof Error
    ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : String(e);
}

/** Runs an IPC call and turns a rejection into a notice instead of an unhandled error. */
export async function tryInvoke<T>(
  run: () => Promise<T>,
  notify: (level: 'error', message: string) => void,
): Promise<T | undefined> {
  try {
    return await run();
  } catch (e) {
    notify('error', ipcErrorMessage(e));
    return undefined;
  }
}
