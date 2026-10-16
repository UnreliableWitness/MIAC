import { useEffect, useState } from 'react';
import { worktreesOf } from '../../shared/tasks';
import { REPO_HAS_WORK, type TaskWorktree } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { TaskTypeIcon } from '../components/TaskTypeIcon';
import { PageHeader } from '../components/ui';
import { useEscape } from '../hooks/useEscape';
import { useGitSummary } from '../hooks/useGitSummary';
import { useRepoConfig } from '../hooks/useRepoConfig';
import { useStore } from '../store';

const STATUS: Record<TaskWorktree['status'], string> = {
  ready: 'Ready',
  'setting-up': 'Setting up',
  'setup-failed': 'Setup failed',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One repo of the task: its folder, branch and git state, and Remove with an inline confirm. */
function RepoRow({
  taskId,
  w,
  name,
  counts,
  onlyOne,
}: {
  taskId: string;
  w: TaskWorktree;
  name: string;
  counts: { ahead: number; files: number } | null;
  onlyOne: boolean;
}) {
  const go = useStore((s) => s.go);
  const notify = useStore((s) => s.notify);
  const [confirm, setConfirm] = useState(false);
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [work, setWork] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async (force: boolean) => {
    setBusy(true);
    try {
      await api().invoke('tasks:removeRepo', taskId, w.repoId, {
        force,
        deleteBranch,
      });
      setConfirm(false);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      const at = m.indexOf(REPO_HAS_WORK);
      if (at >= 0) setWork(m.slice(at + REPO_HAS_WORK.length));
      else notify('error', m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li aria-label={w.dir} className="repos-row">
      <div className="repos-main">
        <span className="mono repos-dir">{w.dir}/</span>
        <span className="muted">repo {name}</span>
        <span className="mono small">{w.branch}</span>
        <span className="muted small">from {w.baseRef}</span>
        <span className={w.status === 'setup-failed' ? 'text-red' : 'muted'}>
          {STATUS[w.status]}
        </span>
        {counts && (
          <span className="small">
            {`${plural(counts.ahead, 'commit')}, ${counts.files} changed`}
          </span>
        )}
        <span className="spacer" />
        {w.status !== 'ready' && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => go({ kind: 'setup', taskId, repoId: w.repoId })}
          >
            Open setup
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm"
          aria-label={`Remove ${w.dir}`}
          disabled={onlyOne || w.status === 'setting-up' || confirm}
          title={
            onlyOne
              ? 'A task keeps at least one repo. Finish the task to remove its last one.'
              : undefined
          }
          onClick={() => {
            setWork(null);
            setConfirm(true);
          }}
        >
          Remove
        </button>
      </div>
      {confirm && (
        <div
          role="group"
          aria-label={`Remove ${w.dir} from this task`}
          className="repos-confirm"
        >
          <div>
            {work
              ? `${w.dir} has ${work}. Removing it loses the uncommitted changes, and the commits too unless the branch is kept.`
              : `Remove ${w.dir} from this task? Its terminals close and its worktree folder is deleted.`}
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={deleteBranch}
              onChange={(e) => setDeleteBranch(e.target.checked)}
            />
            Also delete branch <span className="mono small">{w.branch}</span>
          </label>
          <div className="actions" style={{ justifyContent: 'flex-start' }}>
            <button
              type="button"
              className={work ? 'btn btn-danger btn-sm' : 'btn btn-sm'}
              disabled={busy}
              onClick={() => void remove(work !== null)}
            >
              {work ? 'Remove anyway' : 'Remove'}
            </button>
            <button
              type="button"
              className="btn btn-subtle btn-sm"
              onClick={() => setConfirm(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Add a repo to the task, optionally in place of one of its repos (Move). */
function AddRepo({
  taskId,
  current,
}: {
  taskId: string;
  current: TaskWorktree[];
}) {
  const go = useStore((s) => s.go);
  const notify = useStore((s) => s.notify);
  const repos = useStore((s) => s.repos);
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const taskConnection =
    repos.find((r) => r.id === task?.repoId)?.connectionId ?? null;
  // Same project as the work item, or no project at all: a PR can only link a work item of its own org.
  const eligible = repos.filter(
    (r) =>
      !current.some((w) => w.repoId === r.id) &&
      (r.connectionId === null || r.connectionId === taskConnection),
  );
  const [repoId, setRepoId] = useState(eligible[0]?.id ?? '');
  const config = useRepoConfig(repoId || null);
  const [baseRef, setBaseRef] = useState('');
  const [copy, setCopy] = useState(true);
  const [commands, setCommands] = useState<Record<string, boolean>>({});
  const [replaces, setReplaces] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!config) return;
    setBaseRef(`origin/${config.config.base}`);
    setCopy(true);
    setCommands(Object.fromEntries(config.config.setup.map((c) => [c, true])));
  }, [config]);

  if (eligible.length === 0)
    return (
      <p className="muted">
        No other repo can be added. Add one in Settings; it must be linked to
        this task&apos;s project, or to none.
      </p>
    );

  const add = async () => {
    setBusy(true);
    const ok = await tryInvoke(async () => {
      await api().invoke('tasks:addRepo', taskId, {
        repoId,
        baseRef,
        copy,
        commands: (config?.config.setup ?? []).filter((c) => commands[c]),
        replaces: replaces || null,
      });
      return true;
    }, notify);
    setBusy(false);
    if (ok) go({ kind: 'setup', taskId, repoId });
  };

  const bases = config
    ? [`origin/${config.config.base}`, config.config.base]
    : [];

  return (
    <div className="form-grid repos-add">
      <label htmlFor="ar-repo">Repo to add</label>
      <select
        id="ar-repo"
        className="field"
        value={repoId}
        onChange={(e) => setRepoId(e.target.value)}
      >
        {eligible.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <label htmlFor="ar-base">Base</label>
      <select
        id="ar-base"
        className="field mono"
        value={baseRef}
        onChange={(e) => setBaseRef(e.target.value)}
      >
        {bases.map((b) => (
          <option key={b}>{b}</option>
        ))}
      </select>
      <label htmlFor="ar-replace">Replace</label>
      <select
        id="ar-replace"
        className="field"
        value={replaces}
        onChange={(e) => setReplaces(e.target.value)}
      >
        <option value="">Keep all repos</option>
        {current.map((w) => (
          <option key={w.repoId} value={w.repoId}>
            {`Replace ${w.dir} (move the task)`}
          </option>
        ))}
      </select>
      <span className="label">Setup</span>
      <div>
        {config && config.config.copy.length > 0 && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={copy}
              onChange={(e) => setCopy(e.target.checked)}
            />
            Copy{' '}
            <span className="mono small">{config.config.copy.join(', ')}</span>
          </label>
        )}
        {(config?.config.setup ?? []).map((c) => (
          <label key={c} className="checkbox">
            <input
              type="checkbox"
              checked={commands[c] ?? false}
              onChange={(e) => {
                const { checked } = e.target;
                setCommands((prev) => ({ ...prev, [c]: checked }));
              }}
            />
            <span className="mono">{c}</span>
          </label>
        ))}
        {config &&
          config.config.setup.length === 0 &&
          config.config.copy.length === 0 && (
            <span className="muted small">Nothing to run for this repo.</span>
          )}
      </div>
      <span />
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !repoId || !baseRef}
          onClick={() => void add()}
        >
          Add repo
        </button>
      </div>
      {replaces && (
        <>
          <span />
          <span className="muted small">
            The replaced repo is removed once the new one is set up, unless it
            has commits or uncommitted changes.
          </span>
        </>
      )}
    </div>
  );
}

/** The repos of a task folder: each worktree, and adding, removing or replacing a repo. */
export function ReposScreen({ taskId }: { taskId: string }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const repos = useStore((s) => s.repos);
  const select = useStore((s) => s.select);
  const go = useStore((s) => s.go);
  const back = () => {
    select(taskId);
    go({ kind: 'task' });
  };
  useEscape(back);
  const git = useGitSummary(taskId, task?.worktreeMissing ?? true);
  if (!task) return <div className="empty">Task not found.</div>;
  const worktrees = worktreesOf(task);
  const nameOf = (id: string) => repos.find((r) => r.id === id)?.name ?? id;
  return (
    <div className="page">
      <PageHeader
        before={<TaskTypeIcon task={task} />}
        title={task.workItem?.title ?? task.name}
        after={<span className="muted">Repos</span>}
        commands={
          <button type="button" className="btn" onClick={back}>
            Back to task
          </button>
        }
      />
      <div className="page-body repos">
        <p className="muted small mono">{task.worktreePath}</p>
        <section className="finish-section">
          <h2>In this task</h2>
          <ul aria-label="Repos in this task" className="repos-list">
            {worktrees.map((w) => {
              const g = git?.repos?.find((r) => r.repoId === w.repoId);
              return (
                <RepoRow
                  key={w.repoId}
                  taskId={taskId}
                  w={w}
                  name={nameOf(w.repoId)}
                  counts={g ? { ahead: g.ahead, files: g.files } : null}
                  onlyOne={worktrees.length <= 1}
                />
              );
            })}
          </ul>
        </section>
        <section className="finish-section">
          <h2>Add a repo</h2>
          <p className="muted small">
            The repo gets a worktree in this task folder on branch{' '}
            <span className="mono">{task.branch}</span>. Claude Code keeps its
            conversation and is told about the new repo.
          </p>
          <AddRepo taskId={taskId} current={worktrees} />
        </section>
      </div>
    </div>
  );
}
