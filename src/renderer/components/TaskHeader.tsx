import { useEffect, useState } from 'react';
import type { GitSummary, TaskView } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { ago, eur } from '../format';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { useStore } from '../store';

const POLL_MS = 5000;
const UP = String.fromCharCode(0x2191);
const DOWN = String.fromCharCode(0x2193);

export function TaskHeader({ task }: { task: TaskView }) {
  const go = useStore((s) => s.go);
  const notify = useStore((s) => s.notify);
  const usage = useTaskUsage(task.id);
  const repo = useStore((s) => s.repos.find((r) => r.id === task.repoId));
  const linked = task.workItem !== null && Boolean(repo?.connectionId);
  const syncLine = !linked
    ? 'Not linked to an Azure DevOps work item'
    : task.usageSyncError
      ? `Sync failed: ${task.usageSyncError}`
      : task.usageSyncedAt
        ? `Logged on work item ${ago(task.usageSyncedAt)}`
        : 'Not logged on the work item yet';
  const [git, setGit] = useState<GitSummary | null>(null);

  useEffect(() => {
    let live = true;
    const refresh = () =>
      api()
        .invoke('tasks:gitSummary', task.id)
        .then((g) => {
          if (live) setGit(g);
        })
        .catch(() => {
          if (live) setGit(null);
        });
    void refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [task.id, task.worktreeMissing]);

  const openEditor = () =>
    tryInvoke(() => api().invoke('tasks:openInEditor', task.id), notify);

  return (
    <section className="taskhead">
      <div className="taskhead-text">
        <div className="taskhead-meta">
          {task.workItem?.url ? (
            <button
              type="button"
              className="pill pill-accent pill-link"
              aria-label={`Open ${task.workItem.type} ${task.workItem.id} in Azure DevOps`}
              onClick={() =>
                tryInvoke(
                  () => api().invoke('shell:openExternal', task.workItem!.url!),
                  notify,
                )
              }
            >
              {task.workItem.type} {task.workItem.id}
            </button>
          ) : task.workItem ? (
            <span className="pill pill-accent">
              {task.workItem.type} {task.workItem.id}
            </span>
          ) : (
            <span className="pill pill-accent">Blank task</span>
          )}
          <span>{task.status === 'ready' ? 'Active' : task.status}</span>
        </div>
        <h1>{task.workItem?.title ?? task.name}</h1>
        <div className="taskhead-git">
          <span>{task.branch}</span>
          {git && <span>{`${UP}${git.ahead} ${DOWN}${git.behind}`}</span>}
          {git && git.files.length > 0 && (
            <span
              style={{ color: 'var(--warn)' }}
            >{`${git.files.length} changed`}</span>
          )}
          {git && git.files.length === 0 && <span>clean</span>}
          <span>{task.worktreePath}</span>
        </div>
      </div>
      <button
        type="button"
        className="costtile"
        aria-label="AI cost for this task"
        onClick={() => go({ kind: 'usage', taskId: task.id })}
      >
        <span className="small muted">AI cost</span>
        <span className="amount">
          {usage ? eur(usage.billable.costEur) : <>&mdash;</>}
        </span>
        {usage && (
          <span className="small muted">
            Claude {eur(usage.byTool['claude-code'].costEur)} &middot; Copilot{' '}
            {eur(usage.byTool['copilot-cli'].costEur)}
          </span>
        )}
        <span
          className={task.usageSyncError ? 'small text-red' : 'small muted'}
        >
          {syncLine}
        </span>
      </button>
      <div className="taskhead-actions">
        <button
          type="button"
          className="btn"
          onClick={openEditor}
          disabled={task.worktreeMissing}
        >
          Open in VS Code
        </button>
        <button
          type="button"
          className="btn btn-green"
          onClick={() => go({ kind: 'finish', taskId: task.id })}
        >
          Finish task
        </button>
      </div>
    </section>
  );
}
