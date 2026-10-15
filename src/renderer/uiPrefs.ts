export type UiPrefs = { navCollapsed: boolean; focus: boolean };
const KEY: Record<keyof UiPrefs, string> = {
  navCollapsed: 'miac.ui.navCollapsed',
  focus: 'miac.ui.focus',
};
const DEFAULTS: UiPrefs = { navCollapsed: false, focus: false };
const local = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

export function readPrefs(storage: Storage | undefined = local()): UiPrefs {
  const read = (k: keyof UiPrefs): boolean => {
    try {
      return storage?.getItem(KEY[k]) === 'true';
    } catch {
      return DEFAULTS[k];
    }
  };
  return { navCollapsed: read('navCollapsed'), focus: read('focus') };
}

export function writePref<K extends keyof UiPrefs>(
  key: K,
  value: UiPrefs[K],
  storage: Storage | undefined = local(),
): void {
  try {
    storage?.setItem(KEY[key], String(value));
  } catch {
    /* preferences are best effort */
  }
}
