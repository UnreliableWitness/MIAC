import { type ReactNode, useState } from 'react';
import type { GitSummary, TaskView } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { ago, eur } from '../format';
import { useGitSummary } from '../hooks/useGitSummary';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { useStore } from '../store';
import { IconButton, MindMark, RingGauge, TickRule } from './instrument';

const BRANCH = String.fromCharCode(0x2387);
const UP = String.fromCharCode(0x2191);
const DOWN = String.fromCharCode(0x2193);
const DELTA = String.fromCharCode(0x394);
const PLUS = String.fromCharCode(0xff0b);
const GEAR = String.fromCharCode(0x2699);
const CHECK = String.fromCharCode(0x2713);
const DOT = String.fromCharCode(0xb7);
const DASH = String.fromCharCode(0x2014);

function Home() {
  const go = useStore((s) => s.go);
  return (
    <button
      type="button"
      className="strip-home"
      aria-label="MIAC, back to tasks"
      onClick={() => go({ kind: 'workspace' })}
    >
      <MindMark />
      <span className="strip-word">MIAC</span>
    </button>
  );
}

function TaskDetails({
  task,
  git,
  usage,
  onClose,
}: {
  task: TaskView;
  git: GitSummary | null;
  usage: ReturnType<typeof useTaskUsage>;
  onClose: () => void;
}) {
  const notify = useStore((s) => s.notify);
  const repo = useStore((s) => s.repos.find((r) => r.id === task.repoId));
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
      className="strip-card bracketed"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="strip-card-row">
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
        <span className="muted">
          {task.status === 'ready' ? 'Active' : task.status}
        </span>
      </div>
      <div className="mono">{task.branch}</div>
      {git && (
        <div className="mono muted">
          <span>{`${UP}${git.ahead} ${DOWN}${git.behind}`}</span>{' '}
          {git.files.length > 0 ? (
            <span
              style={{ color: 'var(--warn)' }}
            >{`${git.files.length} changed`}</span>
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

export function TaskStrip({ task }: { task: TaskView }) {
  const go = useStore((s) => s.go);
  const openUsage = useStore((s) => s.openUsage);
  const notify = useStore((s) => s.notify);
  const usage = useTaskUsage(task.id);
  const git = useGitSummary(task.id, task.worktreeMissing);
  const [card, setCard] = useState(false);
  const cost = usage?.billable.costEur ?? 0;
  return (
    <header className="strip">
      <Home />
      <span className="strip-sep" aria-hidden="true">
        /
      </span>
      <div
        className="strip-task"
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
          className="strip-title"
          aria-expanded={card}
          aria-controls="task-details"
          onFocus={() => setCard(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setCard(false);
          }}
        >
          {task.workItem && (
            <span className="mono strip-id">{task.workItem.id}</span>
          )}
          <span className="strip-name">
            {task.workItem?.title ?? task.name}
          </span>
        </button>
        {card && (
          <TaskDetails
            task={task}
            git={git}
            usage={usage}
            onClose={() => setCard(false)}
          />
        )}
      </div>
      <span className="mono strip-git">
        {`${BRANCH} ${task.branch}`}
        {git &&
          ` ${UP}${git.ahead}${git.behind ? ` ${DOWN}${git.behind}` : ''} ${DOT} ${git.files.length ? `${git.files.length}${DELTA}` : 'clean'}`}
      </span>
      <span className="spacer" />
      <button
        type="button"
        className="strip-cost"
        aria-label={`AI cost ${usage ? eur(cost) : 'unknown'}, open usage`}
        onClick={() => openUsage(task.id)}
      >
        <RingGauge value={cost} />{' '}
        <span className="mono">{usage ? eur(cost) : DASH}</span>
      </button>
      {task.status === 'ready' && (
        <>
          <IconButton
            label="Open in VS Code"
            disabled={task.worktreeMissing}
            onClick={() =>
              tryInvoke(
                () => api().invoke('tasks:openInEditor', task.id),
                notify,
              )
            }
          >
            {'{ }'}
          </IconButton>
          <IconButton
            label="Finish task"
            tone="green"
            onClick={() => go({ kind: 'finish', taskId: task.id })}
          >
            {CHECK}
          </IconButton>
        </>
      )}
      <IconButton
        label="New task"
        tone="accent"
        onClick={() => go({ kind: 'new-task' })}
      >
        {PLUS}
      </IconButton>
      <IconButton label="Settings" onClick={() => go({ kind: 'settings' })}>
        {GEAR}
      </IconButton>
      <TickRule />
    </header>
  );
}

export function CrumbStrip({
  crumb,
  back,
  children,
}: {
  crumb: string;
  back?: { label: string; onClick: () => void };
  children?: ReactNode;
}) {
  return (
    <header className="strip">
      <Home />
      <span className="strip-sep" aria-hidden="true">
        /
      </span>
      <span className="strip-crumb">{crumb}</span>
      <span className="spacer" />
      {back && (
        <button type="button" className="linkbtn" onClick={back.onClick}>
          {back.label}
        </button>
      )}
      {children}
      <TickRule />
    </header>
  );
}
