import {
  Add16Regular,
  Add20Regular,
  ArrowSprint20Regular,
  CheckmarkCircle16Regular,
  CheckmarkCircle20Regular,
  ChevronDown12Regular,
  ChevronRight12Regular,
  Document16Regular,
  Home20Regular,
  PanelLeftContract20Regular,
  PanelLeftExpand20Regular,
  Settings20Regular,
} from '@fluentui/react-icons';
import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Repo, TaskStatus, TaskView } from '../../shared/types';
import { activeHome, activeWorkspaces } from '../../shared/workspaces';
import { statusText } from '../connectionStatus';
import { eur, plural } from '../format';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { activeConnection, useStore, useTaskConnectionId } from '../store';
import { AttentionDot } from './AttentionDot';
import { WorkItemTypeIcon } from './ui';

export function groupTasks(tasks: TaskView[], repos: Repo[]) {
  const open = repos
    .map((repo) => ({
      repo,
      // Under the task's active home: its own repo unless Finish dropped it.
      tasks: tasks.filter(
        (t) => activeHome(t).repoId === repo.id && t.status !== 'done',
      ),
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
  const extras = activeWorkspaces(task).length - 1;
  const waiting = useStore((s) => {
    const entries = task.terminals.flatMap((d) => s.attention[d.id] ?? []);
    return entries.find((e) => e.reason === 'blocked') ?? entries[0];
  });
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
      {extras > 0 && (
        <span className="navrow-repos small muted">
          +{plural(extras, 'repo')}
        </span>
      )}
      {waiting && <AttentionDot entry={waiting} />}
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
  const waiting = useStore((s) => {
    const entries = task.terminals.flatMap((d) => s.attention[d.id] ?? []);
    return entries.find((e) => e.reason === 'blocked') ?? entries[0];
  });
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
      {waiting && <AttentionDot entry={waiting} />}
    </button>
  );
}

/** Whether the Finish action shows for a current task: ready, and not on its own Finish page already. */
function useShowsFinish(task: TaskView) {
  const current = useIsCurrent(task.id);
  const onFinish = useStore((s) => s.screen.kind === 'finish');
  return current && !onFinish && task.status === 'ready';
}

const FINISH_TITLE = 'Finish task: check changes, push, book time, clean up';

/** The current task's primary action, right under its row (#95): one click opens the Finish page, which asks first. */
function FinishAction({ task }: { task: TaskView }) {
  const go = useStore((s) => s.go);
  const shows = useShowsFinish(task);
  const current = useIsCurrent(task.id);
  if (current && task.status === 'finishing')
    return (
      <div className="nav-task-action">
        <button type="button" className="btn btn-primary nav-finish" disabled>
          Finishing…
        </button>
      </div>
    );
  if (!shows) return null;
  return (
    <div className="nav-task-action">
      <button
        type="button"
        className="btn btn-primary nav-finish"
        aria-label="Finish task"
        title={FINISH_TITLE}
        onClick={() => go({ kind: 'finish', taskId: task.id })}
      >
        <CheckmarkCircle16Regular aria-hidden="true" />
        Finish task
      </button>
    </div>
  );
}

/** The rail's Finish: a filled square under the current task's icon. */
function RailFinish({ task }: { task: TaskView }) {
  const go = useStore((s) => s.go);
  if (!useShowsFinish(task)) return null;
  return (
    <button
      type="button"
      className="railrow rail-finish"
      aria-label="Finish task"
      title={FINISH_TITLE}
      onClick={() => go({ kind: 'finish', taskId: task.id })}
    >
      <span className="rail-finish-mark">
        <CheckmarkCircle20Regular aria-hidden="true" />
      </span>
    </button>
  );
}

/** Tasks section header with New task on its right; in the rail a + icon heads the task icons. */
function TasksHead({ rail }: { rail: boolean }) {
  const go = useStore((s) => s.go);
  const current = useStore((s) => s.screen.kind === 'new-task');
  if (rail)
    return (
      <button
        type="button"
        className="railrow rail-new"
        aria-label="New task"
        title="New task"
        aria-current={current ? 'true' : undefined}
        onClick={() => go({ kind: 'new-task' })}
      >
        <Add20Regular aria-hidden="true" />
      </button>
    );
  return (
    <div className="nav-section nav-tasks-head">
      <span className="spacer">Tasks</span>
      <button
        type="button"
        className="nav-new"
        title="New task from a work item or a blank one"
        aria-current={current ? 'page' : undefined}
        onClick={() => go({ kind: 'new-task' })}
      >
        <Add16Regular aria-hidden="true" />
        New task
      </button>
    </div>
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
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  // On open, focus the current project; a click outside closes the menu.
  useEffect(() => {
    if (!open) return;
    const items = [
      ...(menu.current?.querySelectorAll<HTMLElement>(
        '[role="menuitemradio"]',
      ) ?? []),
    ];
    (
      items.find((i) => i.getAttribute('aria-checked') === 'true') ?? items[0]
    )?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const onMenuKey = (e: KeyboardEvent) => {
    const items = [
      ...(menu.current?.querySelectorAll<HTMLElement>(
        '[role="menuitemradio"]',
      ) ?? []),
    ];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    };
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at < 0 ? -1 : at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(-1);
    else if (e.key === 'Tab') setOpen(false);
  };
  const name = connection?.project ?? 'No project';
  const avatar = (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        background: connection ? avatarColor(name) : 'var(--bg-selected)',
        color: connection ? undefined : 'var(--muted)',
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
    <div className="projecttile-wrap" ref={wrap}>
      <button
        ref={trigger}
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
          ref={menu}
          role="menu"
          aria-label="Projects"
          className="menu"
          onKeyDown={onMenuKey}
        >
          {connections.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitemradio"
              tabIndex={-1}
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
        icon={<Home20Regular aria-hidden="true" />}
        label="Home"
        rail={rail}
        current={screenKind === 'home'}
        onClick={() => go({ kind: 'home' })}
      />
      <NavItem
        icon={<ArrowSprint20Regular aria-hidden="true" />}
        label="Sprint"
        rail={rail}
        current={screenKind === 'sprint'}
        onClick={() => go({ kind: 'sprint' })}
      />
      <div className="leftnav-scroll">
        <TasksHead rail={rail} />
        {open.map(({ repo, tasks: list }) => (
          <div key={repo.id} role="group" aria-label={repo.name}>
            {!rail && <div className="nav-subhead">{repo.name}</div>}
            {list.map((t) =>
              rail ? (
                <Fragment key={t.id}>
                  <RailRow task={t} />
                  <RailFinish task={t} />
                </Fragment>
              ) : (
                <Fragment key={t.id}>
                  <Row task={t} />
                  <FinishAction task={t} />
                </Fragment>
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
