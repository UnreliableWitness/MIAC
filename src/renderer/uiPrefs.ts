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

const prKey = (repoId: string) => `miac.ui.pr.${repoId}`;
const pushKey = (repoId: string) => `miac.ui.push.${repoId}`;

const readFlag = (key: string, storage: Storage | undefined): boolean => {
  try {
    return storage?.getItem(key) === 'true';
  } catch {
    return false;
  }
};

const writeFlag = (
  key: string,
  value: boolean,
  storage: Storage | undefined,
): void => {
  try {
    storage?.setItem(key, String(value));
  } catch {
    /* preferences are best effort */
  }
};

/** Whether the last Finish of this repo asked for a pull request; false until then. */
export function readPrChoice(
  repoId: string,
  storage: Storage | undefined = local(),
): boolean {
  return readFlag(prKey(repoId), storage);
}

export function writePrChoice(
  repoId: string,
  value: boolean,
  storage: Storage | undefined = local(),
): void {
  writeFlag(prKey(repoId), value, storage);
}

/** Whether the last Finish of this repo (without pull requests) pushed its branch; false until then. */
export function readPushChoice(
  repoId: string,
  storage: Storage | undefined = local(),
): boolean {
  return readFlag(pushKey(repoId), storage);
}

export function writePushChoice(
  repoId: string,
  value: boolean,
  storage: Storage | undefined = local(),
): void {
  writeFlag(pushKey(repoId), value, storage);
}
