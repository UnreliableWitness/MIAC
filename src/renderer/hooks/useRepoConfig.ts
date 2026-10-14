import { useEffect, useState } from 'react';
import type { MiacConfig } from '../../shared/types';
import { api } from '../api';
import { useStore } from '../store';

const cache = new Map<string, { config: MiacConfig; worktreeRoot: string }>();

/** The effective .miac.yml of a repo, cached per session. Returns null until loaded. */
export function useRepoConfig(repoId: string | null) {
  const notify = useStore((s) => s.notify);
  const [value, setValue] = useState(
    repoId ? (cache.get(repoId) ?? null) : null,
  );
  useEffect(() => {
    if (!repoId) return setValue(null);
    const hit = cache.get(repoId);
    if (hit) return setValue(hit);
    setValue(null);
    let live = true;
    void api()
      .invoke('repos:config', repoId)
      .then((r) => {
        cache.set(repoId, r);
        if (live) setValue(r);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setValue(null);
        notify('error', e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [repoId, notify]);
  return value;
}

export function invalidateRepoConfig(repoId?: string) {
  if (repoId) cache.delete(repoId);
  else cache.clear();
}
