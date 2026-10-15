import { Add20Regular, Settings20Regular } from '@fluentui/react-icons';
import { Fragment, type ReactNode, useState } from 'react';
import type { TaskView } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { ago, eur } from '../format';
import { useGitSummary } from '../hooks/useGitSummary';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { activeConnection, useStore } from '../store';
import { TaskTypeIcon } from './TaskTypeIcon';
import { IconButton, MindMark } from './ui';

const UP = String.fromCharCode(0x2191);
const DOWN = String.fromCharCode(0x2193);
const DOT = String.fromCharCode(0xb7);
const SEP = String.fromCharCode(0x203a);

/** "Task 8125 PDP dynamic redirect logic", or the name of a blank task. */
export const taskLabel = (task: TaskView): string =>
  task.workItem
    ? `${task.workItem.type} ${task.workItem.id} ${task.workItem.title}`
    : task.name;

function TaskDetails({
  task,
  onClose,
}: {
  task: TaskView;
  onClose: () => void;
}) {
  const notify = useStore((s) => s.notify);
  const repo = useStore((s) => s.repos.find((r) => r.id === task.repoId));
  const git = useGitSummary(task.id, task.worktreeMissing);
  const usage = useTaskUsage(task.id);
  const linked = task.workItem !== null && Boolean(repo?.connectionId);
  const syncLine = !linked
    ? 'Not linked to an Azure DevOps work item'
    : task.usageSyncError
      ? `Sync failed: ${task.usageSyncError}`
      : task.usageSyncedAt
        ? `Logged on work item ${ago(task.usageSyncedAt)}`
        : 'Not logged on the work item yet';
  return (
    <div
      role="dialog"
      id="task-details"
      aria-label="Task details"
      className="callout"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="callout-row">
        {task.workItem?.url ? (
          <button
            type="button"
            className="link"
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
          <span>
            {task.workItem.type} {task.workItem.id}
          </span>
        ) : (
          <span>Blank task</span>
        )}
        <span className="muted">
          {task.status === 'ready' ? 'Active' : task.status}
        </span>
      </div>
      <div className="mono">{task.branch}</div>
      {git && (
        <div className="mono muted">
          <span>{`${UP}${git.ahead} ${DOWN}${git.behind}`}</span>{' '}
          {git.files.length > 0 ? (
            <span className="text-warn">{`${git.files.length} changed`}</span>
          ) : (
            <span>clean</span>
          )}
        </div>
      )}
      <div className="mono muted">{task.worktreePath}</div>
      {usage && (
        <div className="small muted">
          Claude {eur(usage.byTool['claude-code'].costEur)} {DOT} Copilot{' '}
          {eur(usage.byTool['copilot-cli'].costEur)}
        </div>
      )}
      <div className={task.usageSyncError ? 'small text-red' : 'small muted'}>
        {syncLine}
      </div>
    </div>
  );
}

/** The task crumb; hovering or focusing it shows the task's details. */
function TaskCrumb({ task, current }: { task: TaskView; current: boolean }) {
  const openTask = useStore((s) => s.openTask);
  const [card, setCard] = useState(false);
  return (
    <span
      className="crumb-task"
      onMouseEnter={() => setCard(true)}
      onMouseLeave={(e) => {
        if (!e.currentTarget.contains(document.activeElement)) setCard(false);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setCard(false);
      }}
    >
      <button
        type="button"
        className="crumb"
        aria-current={current ? 'page' : undefined}
        aria-expanded={card}
        aria-controls="task-details"
        onFocus={() => setCard(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && card) {
            e.preventDefault();
            setCard(false);
          }
        }}
        onClick={() => openTask(task.id)}
      >
        <TaskTypeIcon task={task} size={14} />
        <span className="crumb-text">{taskLabel(task)}</span>
      </button>
      {card && <TaskDetails task={task} onClose={() => setCard(false)} />}
    </span>
  );
}

function Crumb({
  current,
  onClick,
  children,
}: {
  current?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="crumb"
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
    >
      <span className="crumb-text">{children}</span>
    </button>
  );
}

/** The 40 px header: logo and breadcrumb on the left, New task and Settings on the right. */
export function HeaderBar() {
  const screen = useStore((s) => s.screen);
  const go = useStore((s) => s.go);
  const connection = useStore(activeConnection);
  const task = useStore((s) => {
    const id =
      s.screen.kind === 'setup' || s.screen.kind === 'finish'
        ? s.screen.taskId
        : s.screen.kind === 'task'
          ? s.selectedTaskId
          : null;
    return s.tasks.find((t) => t.id === id) ?? null;
  });
  const sprintName = useStore((s) => s.sprintName);
  const home = () => go({ kind: 'sprint' });

  const crumbs: ReactNode[] = [];
  if (connection && screen.kind !== 'settings')
    crumbs.push(
      <Crumb key="project" onClick={home}>
        {connection.project}
      </Crumb>,
    );
  if (screen.kind === 'sprint')
    crumbs.push(
      <Crumb key="page" current onClick={home}>
        {sprintName ?? 'Sprint'}
      </Crumb>,
    );
  if (task)
    crumbs.push(
      <TaskCrumb key="task" task={task} current={screen.kind === 'task'} />,
    );
  const page =
    screen.kind === 'setup'
      ? 'Setup'
      : screen.kind === 'finish'
        ? 'Finish'
        : screen.kind === 'new-task'
          ? 'New task'
          : screen.kind === 'settings'
            ? 'Settings'
            : null;
  if (page)
    crumbs.push(
      <Crumb key="page" current onClick={() => undefined}>
        {page}
      </Crumb>,
    );

  return (
    <header className="headerbar">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <button
          type="button"
          className="crumb crumb-home"
          aria-label="MIAC, go to Sprint"
          onClick={home}
        >
          <MindMark />
          <span className="crumb-text">MIAC</span>
        </button>
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            <span className="crumb-sep" aria-hidden="true">
              {SEP}
            </span>
            {c}
          </Fragment>
        ))}
      </nav>
      <span className="spacer" />
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => go({ kind: 'new-task' })}
      >
        <Add20Regular aria-hidden="true" />
        New task
      </button>
      <IconButton label="Settings" onClick={() => go({ kind: 'settings' })}>
        <Settings20Regular />
      </IconButton>
    </header>
  );
}
