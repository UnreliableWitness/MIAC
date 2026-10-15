import { type ReactNode, useEffect, useState } from 'react';
import type {
  TaskSummary,
  TaskView,
  WorkItemSummary,
} from '../../shared/types';
import { api, tryInvoke } from '../api';
import { TaskTypeIcon } from '../components/TaskTypeIcon';
import { PageHeader, StateDot } from '../components/ui';
import { UsagePanel } from '../components/UsagePanel';
import { dateTime, duration, eur } from '../format';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { useStore, useTaskConnectionId } from '../store';

const MINUS = String.fromCharCode(0x2212);

/** The work item's state as ADO has it now; null while loading, when unlinked, or when the call fails. */
function useLiveWorkItem(
  connectionId: string | null,
  id: string | null,
): WorkItemSummary | null {
  const [item, setItem] = useState<WorkItemSummary | null>(null);
  useEffect(() => {
    setItem(null);
    if (!connectionId || !id) return;
    let live = true;
    api()
      .invoke('workItems:get', connectionId, id)
      .then((w) => {
        if (live) setItem(w);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [connectionId, id]);
  return item;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** "pushed to origin" when the upstream is the same branch on a remote, else the upstream in full. */
function pushState(s: TaskSummary, branch: string): string {
  if (!s.upstream) return 'local only';
  const to = s.upstream.endsWith(`/${branch}`)
    ? s.upstream.slice(0, -branch.length - 1)
    : s.upstream;
  return s.pushed ? `pushed to ${to}` : `not all pushed to ${to}`;
}

/** A finished task: what it was, how long it took, what it changed and pushed, what the AI cost, and its usage. */
export function DoneTaskPage({ task }: { task: TaskView }) {
  const notify = useStore((s) => s.notify);
  const connectionId = useTaskConnectionId(task);
  const usage = useTaskUsage(task.id);
  const wi = task.workItem;
  const live = useLiveWorkItem(connectionId, wi?.id ?? null);
  const s = task.summary;
  const took = task.finishedAt
    ? duration(task.createdAt, task.finishedAt)
    : null;
  const logged = !wi
    ? 'No work item'
    : task.usageCommentId !== null
      ? `Yes, ${task.usageSyncedAt ? dateTime(task.usageSyncedAt) : 'on finish'}`
      : task.usageSyncError
        ? `No: ${task.usageSyncError}`
        : 'No';
  return (
    <div className="page page-done">
      <PageHeader
        before={
          wi && (
            <>
              <TaskTypeIcon task={task} size={20} />
              {wi.url ? (
                <button
                  type="button"
                  className="link pagehead-id"
                  aria-label={`Open ${wi.type} ${wi.id} in Azure DevOps`}
                  onClick={() =>
                    tryInvoke(
                      () => api().invoke('shell:openExternal', wi.url!),
                      notify,
                    )
                  }
                >
                  {wi.type} {wi.id}
                </button>
              ) : (
                <span className="pagehead-id">
                  {wi.type} {wi.id}
                </span>
              )}
            </>
          )
        }
        title={wi?.title ?? task.name}
        after={
          live &&
          wi && (
            <span className="pagehead-state" aria-label={`State ${live.state}`}>
              <StateDot
                state={live.state}
                type={live.type || wi.type}
                connectionId={connectionId}
              />
            </span>
          )
        }
      />
      <div className="done-body">
        <dl className="facts">
          <Fact label="Duration">{took ?? 'Unknown'}</Fact>
          <Fact label="Finished">
            {task.finishedAt ? dateTime(task.finishedAt) : 'Unknown'}
          </Fact>
          <Fact label="Branch">
            <span className="mono">{task.branch}</span>
            {s && <span className="muted"> {pushState(s, task.branch)}</span>}
          </Fact>
          {s && s.baseKnown && (
            <Fact label="Changes">
              {s.filesChanged} {s.filesChanged === 1 ? 'file' : 'files'},{' '}
              <span className="text-green">+{s.insertions}</span>{' '}
              <span className="text-red">
                {MINUS}
                {s.deletions}
              </span>
            </Fact>
          )}
          <Fact label="AI cost">
            {usage ? (
              <>
                {eur(usage.billable.costEur)}{' '}
                <span className="muted">
                  (Claude {eur(usage.byTool['claude-code'].costEur)}, Copilot{' '}
                  {eur(usage.byTool['copilot-cli'].costEur)})
                </span>
              </>
            ) : (
              '...'
            )}
          </Fact>
          <Fact label="Logged on work item">{logged}</Fact>
        </dl>
        {s ? (
          <section className="done-commits" aria-label="Commits">
            <h2>
              Commits{' '}
              {s.baseKnown && <span className="muted">{s.commitCount}</span>}
            </h2>
            {!s.baseKnown ? (
              <p className="muted">
                Commits unavailable: MIAC could not find where this branch
                started.
              </p>
            ) : s.commits.length === 0 ? (
              <p className="muted">No commits on this branch.</p>
            ) : (
              <ol>
                {s.commits.map((c) => (
                  <li key={c.sha}>
                    <span className="mono muted">{c.sha}</span>
                    <span className="done-subject">{c.subject}</span>
                  </li>
                ))}
              </ol>
            )}
            {s.commitCount > s.commits.length && (
              <p className="muted small">
                and {s.commitCount - s.commits.length} more
              </p>
            )}
          </section>
        ) : (
          <p className="done-nosummary muted">
            {task.baseSha
              ? 'No summary: git could not read the branch when it finished.'
              : 'Finished before MIAC recorded summaries.'}
          </p>
        )}
        <UsagePanel taskId={task.id} />
      </div>
    </div>
  );
}
