import type { MiacApi } from '../shared/ipc';

export function api(): MiacApi {
  if (!window.miac)
    throw new Error('window.miac is not available: preload did not run');
  return window.miac;
}

/** Runs an IPC call and turns a rejection into a notice instead of an unhandled error. */
export async function tryInvoke<T>(
  run: () => Promise<T>,
  notify: (level: 'error', message: string) => void,
): Promise<T | undefined> {
  try {
    return await run();
  } catch (e) {
    notify(
      'error',
      e instanceof Error
        ? e.message.replace(
            /^Error invoking remote method '[^']+': (Error: )?/,
            '',
          )
        : String(e),
    );
    return undefined;
  }
}
