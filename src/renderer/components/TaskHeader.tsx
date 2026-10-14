import { useEffect, useState } from 'react';
import type { GitSummary, TaskView } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';

const POLL_MS = 5000;
const UP = String.fromCharCode(0x2191);
const DOWN = String.fromCharCode(0x2193);

export function TaskHeader({ task }: { task: TaskView }) {
  const go = useStore((s) => s.go);
  const notify = useStore((s) => s.notify);
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
              className="pill pill-accent"
              style={{ border: 'none', cursor: 'pointer' }}
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
              style={{ color: '#e9b75c' }}
            >{`${git.files.length} changed`}</span>
          )}
          {git && git.files.length === 0 && <span>clean</span>}
          <span>{task.worktreePath}</span>
        </div>
      </div>
      <div className="costtile" aria-label="AI cost for this task">
        <span className="small muted">AI cost</span>
        <span className="amount">&mdash;</span>
        <span className="small muted">
          Usage tracking arrives in a later release
        </span>
      </div>
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
