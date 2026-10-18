import { useEffect, useState } from 'react';
import type { SprintItem } from '../../shared/types';
import { api } from '../api';

/** The work item as ADO has it now; null while loading, when unlinked, or when the call fails. */
export function useLiveWorkItem(
  connectionId: string | null,
  id: string | null,
): SprintItem | null {
  const [item, setItem] = useState<SprintItem | null>(null);
  useEffect(() => {
    setItem(null);
    if (!connectionId || !id) return;
    let live = true;
    api()
      .invoke('workItems:get', connectionId, id)
      .then((w) => {
        if (live) setItem(w);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [connectionId, id]);
  return item;
}
