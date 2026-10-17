import {
  stateCategory,
  type HomeConnection,
  type HomeItem,
  type HomeSnapshot,
} from '../shared/home';
import type { Connection, Repo, TaskView } from '../shared/types';
import { taskConnectionId } from '../shared/workspaces';

/** The health chip of a connection: red when its token was refused or it never loaded, amber when Home shows old data. */
export function chipState(
  home: HomeConnection | undefined,
  connection: Connection,
): 'ok' | 'stale' | 'error' {
  if (connection.status !== 'ok' || home?.status === 'error') return 'error';
  if (home?.status === 'stale') return 'stale';
  return 'ok';
}

export type CategoryOf = (
  connectionId: string,
  type: string,
  state: string,
) => string | null | undefined;

/** The task of a work item on a connection, open ones first (the same rule as the Sprint page). */
export function taskForItem(
  id: string,
  connectionId: string,
  tasks: TaskView[],
  repos: Pick<Repo, 'id' | 'connectionId'>[],
): TaskView | null {
  const matches = tasks.filter(
    (t) => t.workItem?.id === id && taskConnectionId(t, repos) === connectionId,
  );
  return matches.find((t) => t.status !== 'done') ?? matches[0] ?? null;
}

/** My not-started items in current sprints without a MIAC task, soonest sprint end first. */
export function upNext(
  snapshot: HomeSnapshot | null,
  tasks: TaskView[],
  repos: Pick<Repo, 'id' | 'connectionId'>[],
  categoryOf: CategoryOf,
  limit = 3,
): { connectionId: string; item: HomeItem }[] {
  const out: { connectionId: string; item: HomeItem; end: string }[] = [];
  for (const c of snapshot?.connections ?? [])
    for (const s of c.sprints)
      for (const item of s.items)
        if (
          stateCategory(
            categoryOf(c.connectionId, item.type, item.state),
            item.state,
          ) === 'Proposed' &&
          !taskForItem(item.id, c.connectionId, tasks, repos)
        )
          out.push({
            connectionId: c.connectionId,
            item,
            end: s.finishDate ?? '9',
          });
  return out
    .sort((a, b) => a.end.localeCompare(b.end))
    .slice(0, limit)
    .map(({ connectionId, item }) => ({ connectionId, item }));
}
