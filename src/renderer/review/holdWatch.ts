import { api } from '../api';

/**
 * Holds a watcher in main until the returned release is called. Main reference-counts, so an off is sent only
 * for an on that succeeded, and not for a watcher main already stopped (`docs:watchStopped`, which covers both
 * watch channels), which would decrement a newer holder's count. `onLive` learns whether changes are pushed
 * (true) or must be polled (false).
 */
export function holdWatch(
  channel: 'docs:watch' | 'review:watch',
  target: string,
  onLive: (live: boolean) => void = () => {},
): () => void {
  let released = false;
  let held = false;
  let stopped = false;
  const offStopped = api().on('docs:watchStopped', (p) => {
    if (p.taskId !== target) return;
    stopped = true;
    if (!released) onLive(false);
  });
  const sendOff = () => {
    if (!stopped)
      void api()
        .invoke(channel, target, false)
        .catch(() => undefined);
  };
  const pendingOn = api()
    .invoke(channel, target, true)
    .then(
      (r) => {
        held = true;
        // A stop reported before this reply was for the watcher before ours: this on started a new one.
        stopped = false;
        if (!released) onLive(r.live);
        return true;
      },
      () => {
        // No watcher: the holder polls instead.
        if (!released) onLive(false);
        return false;
      },
    );
  return () => {
    released = true;
    offStopped();
    if (held) sendOff();
    else void pendingOn.then((ok) => ok && sendOff());
  };
}
