import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ReviewFiles,
  ReviewScope,
  ReviewState,
} from '../../shared/review';
import type { TaskView } from '../../shared/types';
import {
  activeWorkspaces,
  docsTarget,
  HOME_ID,
  parseDocsTarget,
} from '../../shared/workspaces';
import { api } from '../api';
import { holdWatch } from './holdWatch';

const POLL_MS = 5000;
const SETTLE_MS = 200;

/** The home repo shares the Docs tab's watcher key (the task id); other repos use `<taskId>#<workspaceId>`. */
export const reviewTarget = (taskId: string, workspaceId: string): string =>
  workspaceId === HOME_ID ? taskId : docsTarget(taskId, workspaceId);

/** Follows the task's worktrees (files and git dirs) while `visible`; polls when a watcher is not live. */
function useWorktreeChanges(
  task: TaskView,
  visible: boolean,
  onChange: () => void,
) {
  const latest = useRef(onChange);
  latest.current = onChange;
  const ids = activeWorkspaces(task)
    .map((w) => w.id)
    .join(',');
  useEffect(() => {
    if (!visible || task.status !== 'ready' || task.worktreeMissing) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      timer ??= setTimeout(() => {
        timer = null;
        latest.current();
      }, SETTLE_MS);
    };
    const mine = (target: string) => parseDocsTarget(target).taskId === task.id;
    const offs = [
      api().on('docs:changed', (p) => mine(p.taskId) && soon()),
      api().on('review:changed', (p) => mine(p.taskId) && soon()),
    ];
    let poll: ReturnType<typeof setInterval> | null = null;
    const releases = ids.split(',').map((id) =>
      holdWatch('review:watch', reviewTarget(task.id, id), (live) => {
        if (!live && !poll) poll = setInterval(() => latest.current(), POLL_MS);
      }),
    );
    return () => {
      for (const off of offs) off();
      for (const r of releases) r();
      if (poll) clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
  }, [task.id, task.status, task.worktreeMissing, visible, ids]);
}

export function useReview(
  task: TaskView,
  scope: ReviewScope,
  visible: boolean,
) {
  const [files, setFiles] = useState<ReviewFiles | null>(null);
  const [state, setState] = useState<ReviewState | null>(null);
  const [changedAt, setChangedAt] = useState(0);
  const scopeKey = JSON.stringify(scope);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    const n = ++seq.current;
    void Promise.all([
      api().invoke(
        'review:files',
        task.id,
        JSON.parse(scopeKey) as ReviewScope,
      ),
      api().invoke('review:state', task.id),
    ]).then(
      ([f, s]) => {
        // An answer for an older scope or refresh is dropped.
        if (n !== seq.current) return;
        setFiles(f);
        setState(s);
        setChangedAt((x) => x + 1);
      },
      () => undefined,
    );
  }, [task.id, scopeKey]);

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);
  useWorktreeChanges(task, visible, refresh);

  return { files, state, setState, refresh, changedAt };
}

/** The number of files in All changes, for the pivot's badge. */
export function useChangeCount(
  task: TaskView,
  visible: boolean,
): number | null {
  const [count, setCount] = useState<number | null>(null);
  const refresh = useCallback(() => {
    void api()
      .invoke('review:files', task.id, { kind: 'all' })
      .then(
        (f) => setCount(f.repos.reduce((n, r) => n + r.files.length, 0)),
        () => setCount(null),
      );
  }, [task.id]);
  useEffect(() => {
    if (visible && task.status === 'ready' && !task.worktreeMissing) refresh();
  }, [visible, task.status, task.worktreeMissing, refresh]);
  useWorktreeChanges(task, visible, refresh);
  return count;
}
