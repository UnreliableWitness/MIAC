const DONE = 'shellie.migrated';

/** UI prefs were saved under `miac.*` before the rename; copy them to `shellie.*` once. */
export function migratePrefs(storage: Storage): number {
  if (storage.getItem(DONE)) return 0;
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith('miac.')) keys.push(key);
  }
  let n = 0;
  for (const key of keys) {
    const next = `shellie.${key.slice(5)}`;
    if (storage.getItem(next) !== null) continue;
    storage.setItem(next, storage.getItem(key) ?? '');
    n++;
  }
  storage.setItem(DONE, '1');
  return n;
}
