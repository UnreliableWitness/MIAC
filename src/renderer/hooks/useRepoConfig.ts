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

/** The .miac.yml of several repos (a task folder), in the same order; an entry is null until loaded or on error. */
export function useRepoConfigs(repoIds: string[]) {
  const notify = useStore((s) => s.notify);
  const key = repoIds.join('\n');
  const [value, setValue] = useState(() =>
    repoIds.map((id) => cache.get(id) ?? null),
  );
  useEffect(() => {
    const ids = key ? key.split('\n') : [];
    let live = true;
    setValue(ids.map((id) => cache.get(id) ?? null));
    void Promise.all(
      ids.map(async (id) => {
        const hit = cache.get(id);
        if (hit) return hit;
        try {
          const r = await api().invoke('repos:config', id);
          cache.set(id, r);
          return r;
        } catch (e) {
          if (live) notify('error', e instanceof Error ? e.message : String(e));
          return null;
        }
      }),
    ).then((all) => {
      if (live) setValue(all);
    });
    return () => {
      live = false;
    };
  }, [key, notify]);
  return value;
}

export function invalidateRepoConfig(repoId?: string) {
  if (repoId) cache.delete(repoId);
  else cache.clear();
}
