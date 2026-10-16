import { useEffect } from 'react';
import { api } from '../api';
import { useStore, type Screen } from '../store';

/** The task whose page is on screen: the task page, or its setup or finish page; null elsewhere. */
export function taskOnScreen(s: {
  screen: Screen;
  selectedTaskId: string | null;
}): string | null {
  switch (s.screen.kind) {
    case 'task':
      return s.selectedTaskId;
    case 'setup':
    case 'finish':
      return s.screen.taskId;
    default:
      return null;
  }
}

/** Tells main which task is on screen so it can count the user's time on it. */
export function useTimeFocus(): void {
  useEffect(() => {
    let last = taskOnScreen(useStore.getState());
    return useStore.subscribe((state) => {
      const now = taskOnScreen(state);
      if (now === last) return;
      last = now;
      api()
        .invoke('time:focus', now)
        .catch(() => undefined);
    });
  }, []);
}
