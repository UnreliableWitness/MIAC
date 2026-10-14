import { useEffect } from 'react';
import { USAGE_TAB, useStore } from '../store';

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac/.test(navigator.platform || navigator.userAgent);

/**
 * Tab and Focus shortcuts. The listener runs in the capture phase on window so
 * it fires before xterm sees the key, and it stops the event only when it acts.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey) return;
      const { setTab, toggleFocus, tasks, selectedTaskId } =
        useStore.getState();
      if (e.shiftKey && e.code === 'KeyF') {
        toggleFocus();
      } else if (!e.shiftKey && /^[0-9]$/.test(e.key)) {
        const task = tasks.find((t) => t.id === selectedTaskId);
        if (!task || task.status !== 'ready') return;
        const n = Number(e.key);
        const target = n === 0 ? USAGE_TAB : task.terminals[n - 1]?.id;
        if (!target) return;
        setTab(task.id, target);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
