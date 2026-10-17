import { holdWatch } from '../review/holdWatch';

/** Holds the task's docs watcher; see holdWatch. */
export function holdDocsWatch(
  taskId: string,
  onLive: (live: boolean) => void = () => {},
): () => void {
  return holdWatch('docs:watch', taskId, onLive);
}
