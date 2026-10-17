import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HOME_MAX_AGE_MS,
  HOME_POLL_MS,
  type HomeSnapshot,
} from '../../shared/home';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';

const old = (s: HomeSnapshot | null) =>
  !s || Date.now() - Date.parse(s.builtAt) > HOME_MAX_AGE_MS;

/** Home's snapshot: the cached one at once, rebuilt when old, every 5 minutes while the window has focus, and on demand. */
export function useHome(): {
  snapshot: HomeSnapshot | null;
  refreshing: boolean;
  refresh: () => void;
} {
  const notify = useStore((s) => s.notify);
  const [snapshot, setSnapshot] = useState<HomeSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const current = useRef<HomeSnapshot | null>(null);
  const keep = (s: HomeSnapshot) => {
    current.current = s;
    setSnapshot(s);
  };

  const refresh = useCallback(() => {
    setRefreshing(true);
    void tryInvoke(() => api().invoke('home:refresh'), notify).then((s) => {
      setRefreshing(false);
      if (s) keep(s);
    });
  }, [notify]);

  useEffect(() => {
    let live = true;
    void api()
      .invoke('home:get')
      .then((s) => {
        if (!live) return;
        if (s) keep(s);
        if (old(s)) refresh();
      })
      .catch(() => live && refresh());
    const off = api().on('home:updated', (s) => keep(s));
    const onFocus = () => {
      if (old(current.current)) refresh();
    };
    window.addEventListener('focus', onFocus);
    const poll = setInterval(() => {
      if (document.hasFocus()) refresh();
    }, HOME_POLL_MS);
    return () => {
      live = false;
      off();
      window.removeEventListener('focus', onFocus);
      clearInterval(poll);
    };
  }, [refresh]);

  return { snapshot, refreshing, refresh };
}
