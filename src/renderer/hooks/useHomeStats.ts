import { useEffect, useState } from 'react';
import type { HomePeriod, HomeStats } from '../../shared/home';
import { api } from '../api';

/** Changes arrive every few seconds while an agent runs; stats refetch at most this often. */
const REFETCH_MS = 5_000;

/** The developer's stats for the period, refetched (throttled) when usage, time or tasks change. */
export function useHomeStats(period: HomePeriod): HomeStats | null {
  const [stats, setStats] = useState<HomeStats | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () =>
      api()
        .invoke('home:stats', period)
        .then((s) => live && setStats(s))
        .catch(() => undefined);
    const later = () => {
      timer ??= setTimeout(() => {
        timer = null;
        void load();
      }, REFETCH_MS);
    };
    void load();
    const offs = [
      api().on('usage:changed', later),
      api().on('time:changed', later),
      api().on('tasks:changed', later),
    ];
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      offs.forEach((off) => off());
    };
  }, [period]);
  return stats;
}
