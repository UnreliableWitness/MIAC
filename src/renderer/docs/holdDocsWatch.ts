import { api } from '../api';

/**
 * Holds the task's docs watcher until the returned release is called. Main reference-counts, so an
 * off is sent only for an on that succeeded, and not for a watcher main already stopped
 * (`docs:watchStopped`), which would decrement a newer holder's count. `onLive` learns whether
 * changes are pushed (true) or must be polled (false).
 */
export function holdDocsWatch(
  taskId: string,
  onLive: (live: boolean) => void = () => {},
): () => void {
  let released = false;
  let held = false;
  let stopped = false;
  const offStopped = api().on('docs:watchStopped', (p) => {
    if (p.taskId !== taskId) return;
    stopped = true;
    if (!released) onLive(false);
  });
  const sendOff = () => {
    if (!stopped)
      void api()
        .invoke('docs:watch', taskId, false)
        .catch(() => undefined);
  };
  const pendingOn = api()
    .invoke('docs:watch', taskId, true)
    .then(
      (r) => {
        held = true;
        // A stop reported before this reply was for the watcher before ours: this on started a new one.
        stopped = false;
        if (!released) onLive(r.live);
        return true;
      },
      () => false,
    );
  return () => {
    released = true;
    offStopped();
    if (held) sendOff();
    else void pendingOn.then((ok) => ok && sendOff());
  };
}
