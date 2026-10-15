import { useState } from 'react';
import type { Repo, TaskStatus, TaskView } from '../../shared/types';
import { statusText } from '../connectionStatus';
import { eur } from '../format';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { useStore } from '../store';
import { Bracketed, Label, RingGauge } from './instrument';

const DOWN = String.fromCharCode(0x25be);
const RIGHT = String.fromCharCode(0x25b8);
const DOT = String.fromCharCode(0xb7);
const LEFT_GUILLEMET = String.fromCharCode(0xab);
const RIGHT_GUILLEMET = String.fromCharCode(0xbb);

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

function usePick(task: TaskView) {
  const select = useStore((s) => s.select);
  const go = useStore((s) => s.go);
  return () => {
    select(task.id);
    if (task.status === 'setting-up' || task.status === 'setup-failed')
      go({ kind: 'setup', taskId: task.id });
    else go({ kind: 'workspace' });
  };
}

function Row({ task }: { task: TaskView }) {
  const selected = useStore((s) => s.selectedTaskId === task.id);
  const usage = useTaskUsage(task.id);
  const state = STATE[task.status];
  const pick = usePick(task);
  return (
    <button
      type="button"
      className="taskrow"
      aria-current={selected ? 'true' : undefined}
      onClick={pick}
    >
      <Bracketed active={selected} className="taskrow-frame">
        <span
          className="dot"
          aria-label={
            task.worktreeMissing ? 'Worktree folder missing' : state.label
          }
          style={{
            background: task.worktreeMissing ? 'var(--red)' : state.color,
          }}
        />
        {task.workItem && (
          <span className="taskrow-id">{task.workItem.id}</span>
        )}
        <span className="taskrow-title">
          {task.workItem?.title ?? task.name}
        </span>
        <span className="taskrow-cost">
          {usage && usage.billable.costEur > 0 ? (
            eur(usage.billable.costEur)
          ) : (
            <>&mdash;</>
          )}
        </span>
      </Bracketed>
    </button>
  );
}

function RailRow({ task }: { task: TaskView }) {
  const selected = useStore((s) => s.selectedTaskId === task.id);
  const usage = useTaskUsage(task.id);
  const pick = usePick(task);
  const name =
    `${task.workItem?.id ?? ''} ${task.workItem?.title ?? task.name}`.trim();
  return (
    <button
      type="button"
      className="railrow"
      aria-label={name}
      title={name}
      aria-current={selected ? 'true' : undefined}
      onClick={pick}
    >
      <Bracketed active={selected}>
        <RingGauge value={usage?.billable.costEur ?? 0} size={20} />
      </Bracketed>
    </button>
  );
}

export function TaskNav() {
  const tasks = useStore((s) => s.tasks);
  const repos = useStore((s) => s.repos);
  const connections = useStore((s) => s.connections);
  const selectedTaskId = useStore((s) => s.selectedTaskId);
  const navCollapsed = useStore((s) => s.navCollapsed);
  const setNavCollapsed = useStore((s) => s.setNavCollapsed);
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
    <nav
      aria-label="Tasks"
      className={navCollapsed ? 'tasknav is-rail' : 'tasknav'}
    >
      {open.map(({ repo, tasks: list }) => (
        <div key={repo.id} className="tasknav-group">
          {!navCollapsed && (
            <Label>
              {repo.name} {DOT} {list.length}
            </Label>
          )}
          {list.map((t) =>
            navCollapsed ? (
              <RailRow key={t.id} task={t} />
            ) : (
              <Row key={t.id} task={t} />
            ),
          )}
        </div>
      ))}
      {open.length === 0 && !navCollapsed && (
        <div className="muted small" style={{ padding: 8 }}>
          No open tasks. Create one with New task.
        </div>
      )}
      {done.length > 0 && !navCollapsed && (
        <div className="tasknav-group">
          <button
            type="button"
            className="linkbtn"
            onClick={() => setShowDone(!showDone)}
          >
            {showDone ? DOWN : RIGHT} Done ({done.length})
          </button>
          {showDone && done.map((t) => <Row key={t.id} task={t} />)}
        </div>
      )}
      <div className="tasknav-foot">
        <span
          className="dot"
          style={{ background: footer.color }}
          title={footer.text}
        />
        {!navCollapsed && (
          <span className="tasknav-foot-text">{footer.text}</span>
        )}
        <button
          type="button"
          className="linkbtn"
          aria-label={navCollapsed ? 'Expand task list' : 'Collapse task list'}
          onClick={() => setNavCollapsed(!navCollapsed)}
        >
          {navCollapsed ? RIGHT_GUILLEMET : LEFT_GUILLEMET}
        </button>
      </div>
    </nav>
  );
}
