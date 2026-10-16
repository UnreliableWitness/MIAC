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

/** Whether the last Finish of this repo asked for a pull request; false until then. */
export function readPrChoice(
  repoId: string,
  storage: Storage | undefined = local(),
): boolean {
  try {
    return storage?.getItem(prKey(repoId)) === 'true';
  } catch {
    return false;
  }
}

export function writePrChoice(
  repoId: string,
  value: boolean,
  storage: Storage | undefined = local(),
): void {
  try {
    storage?.setItem(prKey(repoId), String(value));
  } catch {
    /* preferences are best effort */
  }
}

const startRepoKey = (connectionId: string) =>
  `miac.ui.startRepo.${connectionId}`;

/** The repo the last task of this project (connection) was started in; null until then. */
export function readStartRepo(
  connectionId: string,
  storage: Storage | undefined = local(),
): string | null {
  try {
    return storage?.getItem(startRepoKey(connectionId)) ?? null;
  } catch {
    return null;
  }
}

export function writeStartRepo(
  connectionId: string,
  repoId: string,
  storage: Storage | undefined = local(),
): void {
  try {
    storage?.setItem(startRepoKey(connectionId), repoId);
  } catch {
    /* preferences are best effort */
  }
}
