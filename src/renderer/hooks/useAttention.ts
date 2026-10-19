import { useEffect } from 'react';
import type { AttentionView } from '../../shared/attention';
import { api } from '../api';
import { useStore } from '../store';

const viewOf = (s: ReturnType<typeof useStore.getState>): AttentionView =>
  s.screen.kind === 'task' && s.selectedTaskId
    ? { taskId: s.selectedTaskId, tabId: s.activeTab(s.selectedTaskId) }
    : null;

/**
 * Keeps the attention badges in the store, tells main which terminal tab is on screen (so it is never flagged),
 * and opens the task and tab of a clicked notification.
 */
export function useAttention(): void {
  useEffect(() => {
    const send = (view: AttentionView) =>
      api()
        .invoke('attention:view', view)
        .catch(() => undefined);
    let last = JSON.stringify(viewOf(useStore.getState()));
    send(JSON.parse(last) as AttentionView);
    const offStore = useStore.subscribe((state) => {
      const now = JSON.stringify(viewOf(state));
      if (now === last) return;
      last = now;
      send(JSON.parse(now) as AttentionView);
    });
    void api()
      .invoke('attention:get')
      .then((s) => useStore.getState().setAttention(s))
      .catch(() => undefined);
    const offs = [
      api().on('attention:changed', (s) => useStore.getState().setAttention(s)),
      api().on('attention:open', ({ taskId, terminalId }) => {
        useStore.getState().openTab(taskId, terminalId);
      }),
    ];
    return () => {
      offStore();
      offs.forEach((off) => off());
    };
  }, []);
}
