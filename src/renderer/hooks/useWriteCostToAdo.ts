import { useEffect, useState } from 'react';
import { api } from '../api';

/** The `writeCostToAdo` setting (off by default); null until loaded. */
export function useWriteCostToAdo(): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    api()
      .invoke('settings:get')
      .then((s) => {
        if (live) setOn(s.writeCostToAdo);
      })
      .catch(() => {
        if (live) setOn(false);
      });
    return () => {
      live = false;
    };
  }, []);
  return on;
}
