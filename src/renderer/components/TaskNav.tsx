import { useState } from 'react';
import type { Repo, TaskStatus, TaskView } from '../../shared/types';
import { statusText } from '../connectionStatus';
import { useStore } from '../store';

const DOWN = String.fromCharCode(0x25be);
const RIGHT = String.fromCharCode(0x25b8);

export function groupTasks(tasks: TaskView[], repos: Repo[]) {
  const open = repos
    .map((repo) => ({
      repo,
      tasks: tasks.filter((t) => t.repoId === repo.id && t.status !== 'done'),
    }))
    .filter((g) => g.tasks.length > 0);
  const done = tasks.filter((t) => t.status === 'done');
  return { open, done };
}

const STATE: Record<TaskStatus, { color: string; label: string }> = {
  'setting-up': { color: 'var(--accent)', label: 'Setting up' },
  ready: { color: 'var(--idle)', label: 'Ready' },
  'setup-failed': { color: 'var(--red)', label: 'Setup failed' },
  finishing: { color: 'var(--accent)', label: 'Finishing' },
  done: { color: 'var(--idle)', label: 'Done' },
};

function Row({ task }: { task: TaskView }) {
  const selected = useStore((s) => s.selectedTaskId === task.id);
  const select = useStore((s) => s.select);
  const go = useStore((s) => s.go);
  const state = STATE[task.status];
  const pick = () => {
    select(task.id);
    if (task.status === 'setting-up' || task.status === 'setup-failed')
      go({ kind: 'setup', taskId: task.id });
    else go({ kind: 'workspace' });
  };
  return (
    <button
      type="button"
      className="taskrow"
      aria-current={selected ? 'true' : undefined}
      onClick={pick}
    >
      <span className="taskrow-top">
        {task.workItem && (
          <span className="mono small muted">{task.workItem.id}</span>
        )}
        <span className="taskrow-title">
          {task.workItem?.title ?? task.name}
        </span>
        <span
          className="dot"
          aria-label={
            task.worktreeMissing ? 'Worktree folder missing' : state.label
          }
          style={{
            background: task.worktreeMissing ? 'var(--red)' : state.color,
          }}
        />
      </span>
      <span className="taskrow-sub">
        <span>{task.worktreeMissing ? 'folder missing' : task.branch}</span>
        <span className="cost">&mdash;</span>
      </span>
    </button>
  );
}

export function TaskNav() {
  const tasks = useStore((s) => s.tasks);
  const repos = useStore((s) => s.repos);
  const connections = useStore((s) => s.connections);
  const selectedTaskId = useStore((s) => s.selectedTaskId);
  const [showDone, setShowDone] = useState(false);
  const { open, done } = groupTasks(tasks, repos);
  const selected = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const repo = repos.find((r) => r.id === selected?.repoId) ?? repos[0] ?? null;
  const connection = repo?.connectionId
    ? (connections.find((c) => c.id === repo.connectionId) ?? null)
    : null;
  const footer = !connection
    ? { color: 'var(--idle)', text: 'Azure DevOps: not connected' }
    : connection.status === 'ok'
      ? {
          color: 'var(--green)',
          text: `${connection.name}: ${connection.project}`,
        }
      : {
          color: 'var(--red)',
          text: `${connection.name}: ${statusText(connection, true).text}`,
        };
  return (
    <nav aria-label="Tasks" className="tasknav">
      {open.map(({ repo, tasks: list }) => (
        <div key={repo.id} className="tasknav-group">
          <div className="tasknav-head">
            {repo.name}
            <span className="count">{list.length}</span>
          </div>
          {list.map((t) => (
            <Row key={t.id} task={t} />
          ))}
        </div>
      ))}
      {open.length === 0 && (
        <div className="muted small" style={{ padding: 8 }}>
          No open tasks. Create one with New task.
        </div>
      )}
      {done.length > 0 && (
        <div className="tasknav-group">
          <button
            type="button"
            className="tasknav-head"
            onClick={() => setShowDone(!showDone)}
          >
            {showDone ? DOWN : RIGHT} Done ({done.length})
          </button>
          {showDone && done.map((t) => <Row key={t.id} task={t} />)}
        </div>
      )}
      <div className="tasknav-foot">
        <span className="dot" style={{ background: footer.color }} />
        {footer.text}
      </div>
    </nav>
  );
}
