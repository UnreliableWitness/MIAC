import { useEffect } from 'react';
import { api } from '../api';
import { taskOnScreen, useStore } from '../store';

/**
 * Tells main which task is on screen so it can count the user's time on it: once on mount, then on each change of
 * the task on screen or of its status (main does not count a finished task, and counts it again once reopened).
 */
export function useTimeFocus(): void {
  useEffect(() => {
    const key = (state: ReturnType<typeof useStore.getState>) => {
      const id = taskOnScreen(state);
      const status = state.tasks.find((t) => t.id === id)?.status;
      return { id, key: id === null ? '' : `${id}:${status ?? ''}` };
    };
    const send = (id: string | null) => {
      try {
        api()
          .invoke('time:focus', id)
          .catch(() => undefined);
      } catch {
        // No preload (tests without a fake api): nothing to tell.
      }
    };
    const first = key(useStore.getState());
    let last = first.key;
    send(first.id);
    return useStore.subscribe((state) => {
      const now = key(state);
      if (now.key === last) return;
      last = now.key;
      send(now.id);
    });
  }, []);
}
