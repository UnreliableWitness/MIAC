import type { ShellieApi } from '../shared/ipc';
import type { AppSettings } from '../shared/usage';

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

let settingsSaved: ((settings: AppSettings) => void) | null = null;
/** The store keeps its copy of the settings current through this. */
export function onSettingsSaved(listener: (settings: AppSettings) => void) {
  settingsSaved = listener;
}

/**
 * Saves a change to the settings on top of a fresh read, so a save from
 * another section is not overwritten.
 */
export async function saveSettings(
  patch: Partial<AppSettings> | ((fresh: AppSettings) => Partial<AppSettings>),
): Promise<AppSettings> {
  const fresh = await api().invoke('settings:get');
  const saved = await api().invoke('settings:save', {
    ...fresh,
    ...(typeof patch === 'function' ? patch(fresh) : patch),
  });
  settingsSaved?.(saved);
  return saved;
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
