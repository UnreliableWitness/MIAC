import {
  stateCategory,
  type HomeConnection,
  type HomeItem,
  type HomeSnapshot,
  type HomeSprint,
} from '../shared/home';
import { sprintTime } from '../shared/sprintTime';
import type { LocalItemTime } from '../shared/time';
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

/** My items of a sprint by state category, and their spent and estimated time (the Sprint page's rules per item). */
export function sprintTotals(
  sprint: HomeSprint,
  local: Record<string, LocalItemTime>,
  categoryOf: (type: string, state: string) => string | null | undefined,
): {
  todo: number;
  doing: number;
  done: number;
  spentSeconds: number;
  estimateHours: number | null;
} {
  const items = sprint.items.filter(
    (i) => stateCategory(categoryOf(i.type, i.state), i.state) !== 'Removed',
  );
  const cells = sprintTime(
    items.map((item) => ({
      item,
      depth: 0,
      parentId: null,
      hasChildren: false,
    })),
    local,
  );
  let todo = 0;
  let doing = 0;
  let done = 0;
  let spent = 0;
  let estimate = 0;
  let anyEstimate = false;
  for (const i of items) {
    const c = stateCategory(categoryOf(i.type, i.state), i.state);
    if (c === 'Proposed') todo++;
    else if (c === 'Completed') done++;
    else doing++;
    const cell = cells.get(i.id);
    spent += cell?.spentSeconds ?? 0;
    if (cell?.estimateHours != null) {
      estimate += cell.estimateHours;
      anyEstimate = true;
    }
  }
  return {
    todo,
    doing,
    done,
    spentSeconds: spent,
    estimateHours: anyEstimate ? estimate : null,
  };
}
