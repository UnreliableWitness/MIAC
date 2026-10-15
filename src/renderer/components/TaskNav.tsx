import {
  ArrowSprint20Regular,
  ChevronDown12Regular,
  ChevronRight12Regular,
  Document16Regular,
  PanelLeftContract20Regular,
  PanelLeftExpand20Regular,
  Settings20Regular,
} from '@fluentui/react-icons';
import { type ReactNode, useState } from 'react';
import type { Repo, TaskStatus, TaskView } from '../../shared/types';
import { statusText } from '../connectionStatus';
import { eur } from '../format';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { activeConnection, useStore, useTaskConnectionId } from '../store';
import { WorkItemTypeIcon } from './ui';

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

/** Only a task that is not ready gets a status dot. */
const NOT_READY: Partial<Record<TaskStatus, { color: string; label: string }>> =
  {
    'setting-up': { color: 'var(--accent)', label: 'Setting up' },
    'setup-failed': { color: 'var(--red)', label: 'Setup failed' },
    finishing: { color: 'var(--accent)', label: 'Finishing' },
  };

const AVATAR = ['#0078d4', '#8764b8', '#038387', '#ca5010', '#498205'];
const avatarColor = (name: string) =>
  AVATAR[[...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AVATAR.length];

/** The nav highlights a task only while one of its pages is open. */
function useIsCurrent(taskId: string) {
  return useStore((s) =>
    s.screen.kind === 'task'
      ? s.selectedTaskId === taskId
      : (s.screen.kind === 'setup' || s.screen.kind === 'finish') &&
        s.screen.taskId === taskId,
  );
}

function TypeIcon({ task, size = 16 }: { task: TaskView; size?: number }) {
  const connectionId = useTaskConnectionId(task);
  return task.workItem ? (
    <WorkItemTypeIcon
      type={task.workItem.type}
      connectionId={connectionId}
      size={size}
    />
  ) : (
    <Document16Regular className="navrow-blank" aria-label="Blank task" />
  );
}

function Row({ task }: { task: TaskView }) {
  const current = useIsCurrent(task.id);
  const openTask = useStore((s) => s.openTask);
  const usage = useTaskUsage(task.id);
  const state = task.worktreeMissing
    ? { color: 'var(--red)', label: 'Worktree folder missing' }
    : NOT_READY[task.status];
  return (
    <button
      type="button"
      className="navrow"
      aria-current={current ? 'true' : undefined}
      onClick={() => openTask(task.id)}
    >
      <TypeIcon task={task} />
      {task.workItem && <span className="navrow-id">{task.workItem.id}</span>}
      <span className="navrow-title">{task.workItem?.title ?? task.name}</span>
      {state && (
        <span
          className="dot"
          aria-label={state.label}
          title={state.label}
          style={{ background: state.color }}
        />
      )}
      <span className="navrow-cost">
        {usage && usage.billable.costEur > 0 ? eur(usage.billable.costEur) : ''}
      </span>
    </button>
  );
}

function RailRow({ task }: { task: TaskView }) {
  const current = useIsCurrent(task.id);
  const openTask = useStore((s) => s.openTask);
  const name =
    `${task.workItem?.id ?? ''} ${task.workItem?.title ?? task.name}`.trim();
  return (
    <button
      type="button"
      className="railrow"
      aria-label={name}
      title={name}
      aria-current={current ? 'true' : undefined}
      onClick={() => openTask(task.id)}
    >
      <TypeIcon task={task} />
    </button>
  );
}

function NavItem({
  icon,
  label,
  current,
  rail,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  current: boolean;
  rail: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="navitem"
      aria-current={current ? 'page' : undefined}
      aria-label={rail ? label : undefined}
      title={rail ? label : undefined}
      onClick={onClick}
    >
      {icon}
      {!rail && <span>{label}</span>}
    </button>
  );
}

/** The project tile; with more than one connection it opens a project switcher. */
function ProjectTile({ rail }: { rail: boolean }) {
  const connections = useStore((s) => s.connections);
  const connection = useStore(activeConnection);
  const setConnectionId = useStore((s) => s.setConnectionId);
  const go = useStore((s) => s.go);
  const [open, setOpen] = useState(false);
  const name = connection?.project ?? 'No project';
  const avatar = (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        background: connection ? avatarColor(name) : 'var(--bg-selected)',
      }}
    >
      {connection ? name.charAt(0).toUpperCase() : '?'}
    </span>
  );
  if (connections.length < 2)
    return (
      <div className="projecttile" title={name}>
        {avatar}
        {!rail && <span className="projecttile-name">{name}</span>}
      </div>
    );
  return (
    <div className="projecttile-wrap">
      <button
        type="button"
        className="projecttile"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Project ${name}, switch project`}
        title={name}
        onClick={() => setOpen(!open)}
      >
        {avatar}
        {!rail && <span className="projecttile-name">{name}</span>}
        {!rail && <ChevronDown12Regular aria-hidden="true" />}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Projects"
          className="menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
            }
          }}
        >
          {connections.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitemradio"
              aria-checked={c.id === connection?.id}
              className="menu-item"
              onClick={() => {
                setConnectionId(c.id);
                setOpen(false);
                go({ kind: 'sprint' });
              }}
            >
              <span className="menu-title">{c.project}</span>
              <span className="small muted">{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskNav() {
  const tasks = useStore((s) => s.tasks);
  const repos = useStore((s) => s.repos);
  const screenKind = useStore((s) => s.screen.kind);
  const go = useStore((s) => s.go);
  const connection = useStore(activeConnection);
  const navCollapsed = useStore((s) => s.navCollapsed);
  const setNavCollapsed = useStore((s) => s.setNavCollapsed);
  const [showDone, setShowDone] = useState(false);
  const { open, done } = groupTasks(tasks, repos);
  const rail = navCollapsed;
  const footer = !connection
    ? { color: 'var(--disabled)', text: 'Azure DevOps: not connected' }
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
    <nav aria-label="Tasks" className={rail ? 'leftnav is-rail' : 'leftnav'}>
      <ProjectTile rail={rail} />
      <NavItem
        icon={<ArrowSprint20Regular aria-hidden="true" />}
        label="Sprint"
        rail={rail}
        current={screenKind === 'sprint'}
        onClick={() => go({ kind: 'sprint' })}
      />
      <div className="leftnav-scroll">
        {!rail && <div className="nav-section">Tasks</div>}
        {open.map(({ repo, tasks: list }) => (
          <div key={repo.id} role="group" aria-label={repo.name}>
            {!rail && <div className="nav-subhead">{repo.name}</div>}
            {list.map((t) =>
              rail ? (
                <RailRow key={t.id} task={t} />
              ) : (
                <Row key={t.id} task={t} />
              ),
            )}
          </div>
        ))}
        {open.length === 0 && !rail && (
          <div className="nav-empty">No open tasks.</div>
        )}
        {done.length > 0 && !rail && (
          <>
            <button
              type="button"
              className="nav-section nav-section-toggle"
              aria-expanded={showDone}
              onClick={() => setShowDone(!showDone)}
            >
              {showDone ? (
                <ChevronDown12Regular aria-hidden="true" />
              ) : (
                <ChevronRight12Regular aria-hidden="true" />
              )}
              Done ({done.length})
            </button>
            {showDone && done.map((t) => <Row key={t.id} task={t} />)}
          </>
        )}
      </div>
      <div className="leftnav-foot">
        <NavItem
          icon={<Settings20Regular aria-hidden="true" />}
          label="Settings"
          rail={rail}
          current={screenKind === 'settings'}
          onClick={() => go({ kind: 'settings' })}
        />
        <div className="nav-status" title={footer.text}>
          <span className="dot" style={{ background: footer.color }} />
          {!rail && <span className="nav-status-text">{footer.text}</span>}
        </div>
        <button
          type="button"
          className="ibtn nav-collapse"
          aria-label={rail ? 'Expand task list' : 'Collapse task list'}
          title={rail ? 'Expand navigation' : 'Collapse navigation'}
          onClick={() => setNavCollapsed(!rail)}
        >
          {rail ? <PanelLeftExpand20Regular /> : <PanelLeftContract20Regular />}
        </button>
      </div>
    </nav>
  );
}
