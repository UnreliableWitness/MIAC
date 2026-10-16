import { ArrowUndo16Regular } from '@fluentui/react-icons';
import { type ReactNode, useEffect, useState } from 'react';
import type {
  PullRequestRef,
  TaskSummary,
  TaskView,
  WorkItemSummary,
} from '../../shared/types';
import { taskWorkspaces, type WorkspaceView } from '../../shared/workspaces';
import { api, tryInvoke } from '../api';
import { TaskTypeIcon } from '../components/TaskTypeIcon';
import { PageHeader, StateDot } from '../components/ui';
import { UsagePanel } from '../components/UsagePanel';
import { dateTime, duration, eur } from '../format';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { useWriteCostToAdo } from '../hooks/useWriteCostToAdo';
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

/** The pull request as Azure DevOps has it now; starts from the stored one and refreshes once. */
function useLivePullRequest(
  taskId: string,
  workspaceId: string,
  stored: PullRequestRef | null,
): PullRequestRef | null {
  const [pr, setPr] = useState<PullRequestRef | null>(stored);
  const has = stored !== null;
  useEffect(() => {
    setPr(stored);
    if (!has) return;
    let live = true;
    api()
      .invoke('tasks:prStatus', taskId, workspaceId)
      .then((p) => {
        if (live && p) setPr(p);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, workspaceId, has]);
  return pr;
}

function prLabel(pr: PullRequestRef): string {
  if (pr.isDraft && pr.status === 'active') return 'Draft';
  return pr.status.charAt(0).toUpperCase() + pr.status.slice(1);
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

/** The facts of one workspace: its branch and push state, pull request and changes. */
function WorkspaceFacts({ taskId, w }: { taskId: string; w: WorkspaceView }) {
  const notify = useStore((s) => s.notify);
  const pr = useLivePullRequest(taskId, w.id, w.pullRequest);
  const s = w.summary;
  return (
    <>
      <Fact label="Branch">
        <span className="mono">{w.branch}</span>
        {s && <span className="muted"> {pushState(s, w.branch)}</span>}
      </Fact>
      {pr && (
        <Fact label="Pull request">
          <button
            type="button"
            className="link"
            aria-label={`Open pull request ${pr.id} in Azure DevOps`}
            onClick={() =>
              tryInvoke(
                () => api().invoke('shell:openExternal', pr.url),
                notify,
              )
            }
          >
            {`PR ${pr.id} · ${prLabel(pr)}`}
          </button>
        </Fact>
      )}
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
    </>
  );
}

/** The commits of one workspace, or why there is no summary. */
function WorkspaceCommits({ w }: { w: WorkspaceView }) {
  const s = w.summary;
  if (!s)
    return (
      <p className="done-nosummary muted">
        {w.baseSha
          ? 'No summary: git could not read the branch when it finished.'
          : 'Finished before MIAC recorded summaries.'}
      </p>
    );
  return (
    <section className="done-commits" aria-label="Commits">
      <h2>
        Commits {s.baseKnown && <span className="muted">{s.commitCount}</span>}
      </h2>
      {!s.baseKnown ? (
        <p className="muted">
          Commits unavailable: MIAC could not find where this branch started.
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
  );
}

/** The repo's name, or its worktree folder when the repo was removed from MIAC. */
function useRepoName(w: WorkspaceView): string {
  const repos = useStore((s) => s.repos);
  return (
    repos.find((r) => r.id === w.repoId)?.name ??
    w.worktreePath.split(/[\\/]/).filter(Boolean).pop() ??
    w.repoId
  );
}

function WorkspaceSection({ task, w }: { task: TaskView; w: WorkspaceView }) {
  const name = useRepoName(w);
  return (
    <section className="done-workspace" aria-label={name}>
      <h2>{name}</h2>
      <dl className="facts">
        <WorkspaceFacts taskId={task.id} w={w} />
      </dl>
      <WorkspaceCommits w={w} />
    </section>
  );
}

function DroppedNote({ w }: { w: WorkspaceView }) {
  const name = useRepoName(w);
  return <p className="muted done-dropped">{`${name}: no changes, removed`}</p>;
}

/** A finished task: what it was, how long it took, what it changed and pushed, what the AI cost, and its usage. */
export function DoneTaskPage({ task }: { task: TaskView }) {
  const notify = useStore((s) => s.notify);
  const go = useStore((s) => s.go);
  const select = useStore((s) => s.select);
  const openTask = useStore((s) => s.openTask);
  const [reopening, setReopening] = useState(false);
  const reopen = async () => {
    setReopening(true);
    const r = await tryInvoke(
      () => api().invoke('tasks:reopen', task.id),
      notify,
    );
    setReopening(false);
    if (!r) return;
    if (r.setup) {
      select(task.id);
      go({ kind: 'setup', taskId: task.id });
    } else openTask(task.id);
  };
  const connectionId = useTaskConnectionId(task);
  const usage = useTaskUsage(task.id);
  const wi = task.workItem;
  const live = useLiveWorkItem(connectionId, wi?.id ?? null);
  const workspaces = taskWorkspaces(task);
  const multi = task.extraWorkspaces.length > 0;
  const took = task.finishedAt
    ? duration(task.createdAt, task.finishedAt)
    : null;
  const writeCost = useWriteCostToAdo();
  const logged = !wi
    ? 'No work item'
    : task.usageCommentId !== null
      ? `Yes, ${task.usageSyncedAt ? dateTime(task.usageSyncedAt) : 'on finish'}`
      : task.usageSyncError
        ? `No: ${task.usageSyncError}`
        : writeCost === false
          ? 'No (off in Settings)'
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
        commands={
          <button
            type="button"
            className="btn"
            disabled={reopening}
            title="Back to work on this task: its worktree, terminals and Claude sessions"
            onClick={() => void reopen()}
          >
            <ArrowUndo16Regular aria-hidden="true" />
            {reopening ? 'Reopening' : 'Reopen'}
          </button>
        }
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
          {!multi && <WorkspaceFacts taskId={task.id} w={workspaces[0]} />}
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
        {multi ? (
          <>
            {workspaces
              .filter((w) => !w.dropped)
              .map((w) => (
                <WorkspaceSection key={w.id} task={task} w={w} />
              ))}
            {workspaces
              .filter((w) => w.dropped)
              .map((w) => (
                <DroppedNote key={w.id} w={w} />
              ))}
          </>
        ) : (
          <WorkspaceCommits w={workspaces[0]} />
        )}
        <UsagePanel taskId={task.id} />
      </div>
    </div>
  );
}
