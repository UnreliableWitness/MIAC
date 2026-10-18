export type DocView = 'rendered' | 'source';
export type DocState = { path: string | null; view: DocView; scroll: number };
const DEFAULT: DocState = { path: null, view: 'rendered', scroll: 0 };
const local = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

export function readDocState(taskId: string, storage = local()): DocState {
  try {
    const v = JSON.parse(
      storage?.getItem(`shellie.docs.${taskId}`) ?? 'null',
    ) as Partial<DocState> | null;
    if (!v || typeof v !== 'object') return { ...DEFAULT };
    return {
      path: typeof v.path === 'string' ? v.path : null,
      view: v.view === 'source' ? 'source' : 'rendered',
      scroll: typeof v.scroll === 'number' && v.scroll >= 0 ? v.scroll : 0,
    };
  } catch {
    return { ...DEFAULT };
  }
}
export function writeDocState(
  taskId: string,
  state: DocState,
  storage = local(),
): void {
  try {
    storage?.setItem(`shellie.docs.${taskId}`, JSON.stringify(state));
  } catch {
    /* best effort */
  }
}
export const readListCollapsed = (storage = local()): boolean => {
  try {
    return storage?.getItem('shellie.docs.listCollapsed') === 'true';
  } catch {
    return false;
  }
};
export const writeListCollapsed = (v: boolean, storage = local()): void => {
  try {
    storage?.setItem('shellie.docs.listCollapsed', String(v));
  } catch {
    /* best effort */
  }
};
export const readSendTarget = (
  taskId: string,
  storage = local(),
): string | null => {
  try {
    return storage?.getItem(`shellie.docs.sendTo.${taskId}`) ?? null;
  } catch {
    return null;
  }
};
export const writeSendTarget = (
  taskId: string,
  id: string,
  storage = local(),
): void => {
  try {
    storage?.setItem(`shellie.docs.sendTo.${taskId}`, id);
  } catch {
    /* best effort */
  }
};
