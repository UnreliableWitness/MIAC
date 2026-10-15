import { useEffect } from 'react';
import { create } from 'zustand';
import type { WorkItemStateMeta, WorkItemTypeMeta } from '../shared/types';
import { api } from './api';

/** After a failed load, wait this long before asking main again. */
const RETRY_MS = 60_000;

type Entry =
  | { status: 'loading' }
  | { status: 'ok'; types: Map<string, WorkItemTypeMeta> }
  | { status: 'failed'; at: number };

type TypesStore = {
  byConnection: Record<string, Entry>;
  load(connectionId: string): void;
  /** Forgets connections that are gone and failed loads, so a fixed connection loads again. */
  prune(connectionIds: string[]): void;
  reset(): void;
};

/** The project's work item types (real icons, type and state colors) per connection, loaded once per session. */
export const useWorkItemTypes = create<TypesStore>((set, get) => ({
  byConnection: {},
  load: (connectionId) => {
    const entry = get().byConnection[connectionId];
    if (
      entry &&
      (entry.status !== 'failed' || Date.now() - entry.at < RETRY_MS)
    )
      return;
    const put = (e: Entry) =>
      set({ byConnection: { ...get().byConnection, [connectionId]: e } });
    put({ status: 'loading' });
    let pending: Promise<WorkItemTypeMeta[]>;
    try {
      pending = api().invoke('workItems:types', connectionId);
    } catch {
      put({ status: 'failed', at: Date.now() });
      return;
    }
    pending.then(
      (types) =>
        put({
          status: 'ok',
          types: new Map(types.map((t) => [t.name.toLowerCase(), t])),
        }),
      () => put({ status: 'failed', at: Date.now() }),
    );
  },
  prune: (connectionIds) => {
    const keep = new Set(connectionIds);
    const next = Object.fromEntries(
      Object.entries(get().byConnection).filter(
        ([id, e]) => keep.has(id) && e.status !== 'failed',
      ),
    );
    if (Object.keys(next).length !== Object.keys(get().byConnection).length)
      set({ byConnection: next });
  },
  reset: () => set({ byConnection: {} }),
}));

/** The metadata of one type, or undefined until it is loaded (or when it cannot be). Starts the load. */
export function useTypeMeta(
  connectionId: string | null | undefined,
  type: string | null | undefined,
): WorkItemTypeMeta | undefined {
  const load = useWorkItemTypes((s) => s.load);
  useEffect(() => {
    if (connectionId) load(connectionId);
  }, [connectionId, load]);
  return useWorkItemTypes((s) => {
    if (!connectionId || !type) return undefined;
    const e = s.byConnection[connectionId];
    return e?.status === 'ok' ? e.types.get(type.toLowerCase()) : undefined;
  });
}

export const stateMeta = (
  meta: WorkItemTypeMeta | undefined,
  state: string,
): WorkItemStateMeta | undefined =>
  meta?.states.find((s) => s.name.toLowerCase() === state.toLowerCase());
