import { useEffect, useState } from 'react';
import type { MiacConfig } from '../../shared/types';
import { api } from '../api';

const cache = new Map<string, { config: MiacConfig; worktreeRoot: string }>();

/** The effective .miac.yml of a repo, cached per session. Returns null until loaded. */
export function useRepoConfig(repoId: string | null) {
  const [value, setValue] = useState(
    repoId ? (cache.get(repoId) ?? null) : null,
  );
  useEffect(() => {
    if (!repoId) return;
    const hit = cache.get(repoId);
    if (hit) return setValue(hit);
    let live = true;
    void api()
      .invoke('repos:config', repoId)
      .then((r) => {
        cache.set(repoId, r);
        if (live) setValue(r);
      })
      .catch(() => {
        if (live) setValue(null);
      });
    return () => {
      live = false;
    };
  }, [repoId]);
  return value;
}

export function invalidateRepoConfig(repoId?: string) {
  if (repoId) cache.delete(repoId);
  else cache.clear();
}
