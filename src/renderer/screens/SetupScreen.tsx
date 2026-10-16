import { useEffect, useRef, useState } from 'react';
import type { SetupEvent, SetupState } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { StepList } from '../components/StepList';
import { TaskTypeIcon } from '../components/TaskTypeIcon';
import { PageHeader } from '../components/ui';
import { useStore } from '../store';

export function applySetupEvent(state: SetupState, e: SetupEvent): SetupState {
  if (e.type === 'log') return { ...state, log: [...state.log, e.line] };
  if (e.type === 'step') {
    const steps = state.steps.map((s, i) =>
      i === e.index
        ? {
            ...s,
            status: e.status,
            detail: e.status === 'running' ? e.detail : (e.detail ?? s.detail),
            ms: e.status === 'running' ? e.ms : (e.ms ?? s.ms),
          }
        : s,
    );
    if (e.status === 'running')
      return { ...state, steps, finished: false, ok: null, failedStep: null };
    return { ...state, steps };
  }
  return {
    ...state,
    finished: true,
    ok: e.ok,
    failedStep: e.failedStep ?? null,
  };
}

const EMPTY_STATE: SetupState = {
  steps: [],
  log: [],
  finished: false,
  ok: null,
  failedStep: null,
};

/** Applies events buffered during the snapshot fetch, skipping log lines the snapshot already holds. */
function replayPending(
  snapshot: SetupState,
  pending: SetupEvent[],
): SetupState {
  const buffered = pending.flatMap((e) => (e.type === 'log' ? [e.line] : []));
  let overlap = 0;
  for (let j = Math.min(buffered.length, snapshot.log.length); j > 0; j--) {
    const tail = snapshot.log.slice(snapshot.log.length - j);
    if (tail.every((line, i) => line === buffered[i])) {
      overlap = j;
      break;
    }
  }
  let skip = overlap;
  let state = snapshot;
  for (const e of pending) {
    if (e.type === 'log' && skip > 0) {
      skip--;
      continue;
    }
    state = applySetupEvent(state, e);
  }
  return state;
}

/** A task's setup, or with `repoId` the setup of a repo being added to a running task folder. */
export function SetupScreen({
  taskId,
  repoId,
}: {
  taskId: string;
  repoId?: string;
}) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const worktree = repoId
    ? task?.worktrees?.find((w) => w.repoId === repoId)
    : undefined;
  const go = useStore((s) => s.go);
  const select = useStore((s) => s.select);
  const notify = useStore((s) => s.notify);
  const [state, setState] = useState<SetupState | null>(null);
  const [follow, setFollow] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    let pending: SetupEvent[] | null = [];
    const off = api().on('setup', (e) => {
      if (e.taskId !== taskId || e.repoId !== repoId) return;
      if (pending) {
        pending.push(e);
        return;
      }
      setState((prev) => (prev ? applySetupEvent(prev, e) : prev));
      if (e.type === 'finished' && e.ok) {
        select(taskId);
        go({ kind: 'task' });
      }
    });
    void tryInvoke(
      () =>
        api().invoke('tasks:setupState', taskId, ...(repoId ? [repoId] : [])),
      notify,
    ).then((snapshot) => {
      const buffered = pending ?? [];
      pending = null;
      if (!live) return;
      const next = replayPending(snapshot ?? EMPTY_STATE, buffered);
      setState(next);
      if (next.finished && next.ok) {
        select(taskId);
        go({ kind: 'task' });
      }
    });
    return () => {
      live = false;
      off();
    };
  }, [taskId, repoId, go, select, notify]);

  useEffect(() => {
    if (follow && logRef.current)
      logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state?.log.length, follow]);

  const failedStep = state?.failedStep ?? null;
  const failedLabel =
    failedStep !== null ? state?.steps[failedStep]?.def.label : null;
  const running = state?.steps.find((s) => s.status === 'running');

  const retry = async () => {
    const ok = await tryInvoke(async () => {
      if (repoId) await api().invoke('tasks:retryRepoSetup', taskId, repoId);
      else await api().invoke('tasks:retrySetup', taskId);
      return true;
    }, notify);
    if (!ok) return;
    const fresh = await tryInvoke(
      () =>
        api().invoke('tasks:setupState', taskId, ...(repoId ? [repoId] : [])),
      notify,
    );
    if (fresh) setState(fresh);
  };
  const cancel = async () => {
    if (repoId) {
      // A repo that failed to be added goes again; the task and its other repos stay.
      const removed = await tryInvoke(async () => {
        await api().invoke('tasks:removeRepo', taskId, repoId, {
          force: false,
          deleteBranch: true,
        });
        return true;
      }, notify);
      if (removed) go({ kind: 'repos', taskId });
      return;
    }
    const ok = await tryInvoke(async () => {
      await api().invoke('tasks:cancelSetup', taskId);
      return true;
    }, notify);
    // A cancelled reopen leaves the task on its Done page; a cancelled new task is gone.
    // The task page shows the Done page once the task is done again.
    if (ok && reopening) {
      select(taskId);
      go({ kind: 'task' });
    } else if (ok) go({ kind: 'sprint' });
  };

  if (!task) return <div className="empty">Task not found.</div>;
  const back = () =>
    repoId ? (select(taskId), go({ kind: 'task' })) : go({ kind: 'sprint' });
  const reopening = !repoId && task.reopen !== null;
  // Adding a repo: its own status; the task itself stays ready.
  const status = repoId ? (worktree?.status ?? 'ready') : task.status;

  return (
    <div className="page">
      <PageHeader
        before={<TaskTypeIcon task={task} />}
        title={task.workItem?.title ?? task.name}
        after={
          <span className="muted">
            {task.workItem
              ? `${task.workItem.type} ${task.workItem.id}`
              : 'Blank task'}
          </span>
        }
      />
      <div className="setup">
        <section className="setup-left">
          <div className="muted">
            {repoId
              ? status === 'setup-failed'
                ? `Adding ${worktree?.dir ?? 'the repo'} failed. Fix the cause, then retry, or remove the repo.`
                : status === 'ready'
                  ? 'Repo added.'
                  : `Adding ${worktree?.dir ?? 'the repo'} to this task. Its terminals keep running; you can leave this page.`
              : reopening
                ? task.status === 'setup-failed'
                  ? 'Reopening failed. Fix the cause, then retry, or cancel: the task goes back to Done.'
                  : 'Restoring the worktree and terminals of this task. You can leave this page; it keeps going in the background.'
                : task.status === 'setup-failed'
                  ? 'Setup failed. Fix the cause, then retry, or remove the task.'
                  : task.status === 'ready'
                    ? 'Setup finished.'
                    : 'Setting up your task. You can leave this page; it keeps going in the background.'}
          </div>
          {state ? (
            <StepList steps={state.steps} />
          ) : (
            <div className="muted">Loading...</div>
          )}
          <div className="actions" style={{ justifyContent: 'flex-start' }}>
            <button type="button" className="btn" onClick={back}>
              {repoId ? 'Back to task' : 'Back to Sprint'}
            </button>
            {status === 'setup-failed' && (
              <button type="button" className="btn btn-primary" onClick={retry}>
                {failedLabel ? `Retry from ${failedLabel}` : 'Retry'}
              </button>
            )}
            <button
              type="button"
              className="btn btn-warn"
              disabled={status === 'setting-up'}
              onClick={cancel}
            >
              {repoId
                ? 'Remove repo'
                : reopening
                  ? 'Cancel reopen'
                  : 'Cancel and remove'}
            </button>
          </div>
        </section>
        <section className="setup-log" aria-label="Setup log">
          <div className="setup-log-head">
            <span style={{ fontWeight: 600 }}>
              {running?.def.label ??
                (state?.finished ? (state.ok ? 'Done' : 'Failed') : 'Starting')}
            </span>
            <span className="small muted">live output</span>
            <label className="checkbox small" style={{ marginLeft: 'auto' }}>
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => setFollow(e.target.checked)}
              />
              Follow
            </label>
          </div>
          <div className="setup-log-body" ref={logRef}>
            {(state?.log ?? []).map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
