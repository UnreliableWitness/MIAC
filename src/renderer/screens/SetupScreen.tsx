import { useEffect, useRef, useState } from 'react';
import type { SetupEvent, SetupState } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { StepList } from '../components/StepList';
import { CrumbStrip } from '../components/TaskStrip';
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

export function SetupScreen({ taskId }: { taskId: string }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const repo = useStore((s) => s.repos.find((r) => r.id === task?.repoId));
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
      if (e.taskId !== taskId) return;
      if (pending) {
        pending.push(e);
        return;
      }
      setState((prev) => (prev ? applySetupEvent(prev, e) : prev));
      if (e.type === 'finished' && e.ok) {
        select(taskId);
        go({ kind: 'workspace' });
      }
    });
    void tryInvoke(() => api().invoke('tasks:setupState', taskId), notify).then(
      (snapshot) => {
        const buffered = pending ?? [];
        pending = null;
        if (!live) return;
        const next = replayPending(snapshot ?? EMPTY_STATE, buffered);
        setState(next);
        if (next.finished && next.ok) {
          select(taskId);
          go({ kind: 'workspace' });
        }
      },
    );
    return () => {
      live = false;
      off();
    };
  }, [taskId, go, select, notify]);

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
      await api().invoke('tasks:retrySetup', taskId);
      return true;
    }, notify);
    if (!ok) return;
    const fresh = await tryInvoke(
      () => api().invoke('tasks:setupState', taskId),
      notify,
    );
    if (fresh) setState(fresh);
  };
  const cancel = async () => {
    const ok = await tryInvoke(async () => {
      await api().invoke('tasks:cancelSetup', taskId);
      return true;
    }, notify);
    if (ok) go({ kind: 'workspace' });
  };

  if (!task) return <div className="empty">Task not found.</div>;

  return (
    <>
      <CrumbStrip
        crumb={`${repo?.name ?? ''} / ${task.workItem?.id ?? task.name} / setup`}
        back={{
          label: 'Back to tasks',
          onClick: () => go({ kind: 'workspace' }),
        }}
      />
      <div className="setup">
        <section className="setup-left">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {task.workItem ? (
              <span
                className="pill pill-blue"
                style={{ alignSelf: 'flex-start' }}
              >
                {task.workItem.type} {task.workItem.id}
              </span>
            ) : (
              <span
                className="pill pill-accent"
                style={{ alignSelf: 'flex-start' }}
              >
                Blank task
              </span>
            )}
            <h1>{task.workItem?.title ?? task.name}</h1>
            <div className="muted">
              {task.status === 'setup-failed'
                ? 'Setup failed. Fix the cause, then retry, or remove the task.'
                : task.status === 'ready'
                  ? 'Setup finished.'
                  : 'Setting up your task. You can go back to the task list; it keeps going in the background.'}
            </div>
          </div>
          {state ? (
            <StepList steps={state.steps} />
          ) : (
            <div className="muted">Loading...</div>
          )}
          <div className="actions" style={{ justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="btn"
              onClick={() => go({ kind: 'workspace' })}
            >
              Back to tasks
            </button>
            {task.status === 'setup-failed' && (
              <button type="button" className="btn btn-primary" onClick={retry}>
                {failedLabel ? `Retry from ${failedLabel}` : 'Retry'}
              </button>
            )}
            <button
              type="button"
              className="btn btn-warn"
              disabled={task.status === 'setting-up'}
              onClick={cancel}
            >
              Cancel and remove
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
    </>
  );
}
