import type { Environment } from '../../shared/secrets';

/** How often Production bounds are checked (and also at once, and when the machine wakes). */
export const EXPIRY_CHECK_MS = 30_000;

/** Main: setInterval and powerMonitor's `resume`; tests drive both by hand. Each returns its unsubscribe. */
export type ExpiryTimers = {
  every: (fn: () => void, ms: number) => () => void;
  onResume: (fn: () => void) => () => void;
};

type Bounded = {
  id: string;
  environment: Environment;
  environmentUntil: string | null;
};

/** The ids of tasks on Production whose bound is now or past. */
export function expiredTasks(tasks: readonly Bounded[], now: number): string[] {
  return tasks
    .filter(
      (t) =>
        t.environment === 'production' &&
        t.environmentUntil !== null &&
        Date.parse(t.environmentUntil) <= now,
    )
    .map((t) => t.id);
}

/**
 * Ends Production for each task past its bound: checks at once (a relaunch after the bound), every 30 s and on
 * resume from sleep. A task whose expiry is still running is not expired again; a failed one is tried again on the
 * next check. Returns the function that stops the checks.
 */
export function scheduleExpiry(
  tasks: () => readonly Bounded[],
  now: () => number,
  onExpire: (taskId: string) => Promise<void> | void,
  timers: ExpiryTimers,
): () => void {
  const running = new Set<string>();
  const check = () => {
    for (const id of expiredTasks(tasks(), now())) {
      if (running.has(id)) continue;
      running.add(id);
      let done: Promise<void> | void;
      try {
        done = onExpire(id);
      } catch (e) {
        done = Promise.reject(e);
      }
      void Promise.resolve(done)
        .catch((e: unknown) =>
          console.error('[secrets] could not end Production', e),
        )
        .finally(() => running.delete(id));
    }
  };
  const stopInterval = timers.every(check, EXPIRY_CHECK_MS);
  const stopResume = timers.onResume(check);
  check();
  return () => {
    stopInterval();
    stopResume();
  };
}
