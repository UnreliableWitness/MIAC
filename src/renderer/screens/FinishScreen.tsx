import { useEffect, useState } from 'react';
import type { FinishChecks } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { eur } from '../format';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { useStore } from '../store';

const ELLIPSIS = String.fromCharCode(0x2026);
const G = {
  WARN: String.fromCharCode(0x26a0),
  OK: String.fromCharCode(0x2713),
  UP: String.fromCharCode(0x2191),
  PLAY: String.fromCharCode(0x25b6),
};

export function FinishScreen({ taskId }: { taskId: string }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const go = useStore((s) => s.go);
  const notify = useStore((s) => s.notify);
  const [checks, setChecks] = useState<FinishChecks | null>(null);
  const [closeTerminals, setCloseTerminals] = useState(true);
  const [removeWorktree, setRemoveWorktree] = useState(true);
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checksFailed, setChecksFailed] = useState<string | null>(null);
  const ready = task?.status === 'ready';
  const usage = useTaskUsage(ready ? taskId : null);
  const repo = useStore((s) => s.repos.find((r) => r.id === task?.repoId));
  const canSync = Boolean(task?.workItem) && Boolean(repo?.connectionId);
  // Untouched (null) defaults to on, except when no usage was captured.
  const [syncChoice, setSyncUsage] = useState<boolean | null>(null);
  const syncUsage = syncChoice ?? !(usage && usage.sessions.length === 0);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    void tryInvoke(async () => {
      try {
        return await api().invoke('tasks:finishChecks', taskId);
      } catch (e) {
        if (live)
          setChecksFailed(e instanceof Error ? e.message : 'unknown error');
        throw e;
      }
    }, notify).then((c) => {
      if (live && c) setChecks(c);
    });
    return () => {
      live = false;
    };
  }, [taskId, notify, ready]);

  if (!task) return null;

  if (!ready) {
    return (
      <div className="overlay" style={{ paddingTop: 72 }}>
        <div role="dialog" aria-labelledby="fn-title" className="dialog finish">
          <h2 id="fn-title">Finish task {task.workItem?.id ?? task.name}</h2>
          <div className="muted">{`This task is ${task.status}. Finish it once setup has succeeded; use the Setup screen to retry or remove it.`}</div>
          <div className="finish-foot">
            <button
              type="button"
              className="btn"
              onClick={() => go({ kind: 'workspace' })}
            >
              Keep task
            </button>
          </div>
        </div>
      </div>
    );
  }

  const openGit = async (label: string, command: string) => {
    const opened = await tryInvoke(
      () =>
        api().invoke('terminals:open', taskId, { kind: 'run', label, command }),
      notify,
    );
    if (opened) go({ kind: 'workspace' });
  };

  const finish = async () => {
    setBusy(true);
    const ok = await tryInvoke(async () => {
      await api().invoke('tasks:finish', taskId, {
        closeTerminals: closeTerminals && nTerm > 0,
        removeWorktree,
        deleteBranch,
        syncUsage: canSync && syncUsage,
      });
      return true;
    }, notify);
    setBusy(false);
    if (ok) go({ kind: 'workspace' });
  };

  const dirty = checksFailed
    ? true
    : checks
      ? checks.uncommitted.length > 0 || checks.unpushed > 0
      : false;
  const nTerm = task.terminals.length;
  const terminalLabels = task.terminals.map((t) => t.label).join(', ');

  return (
    <div className="overlay" style={{ paddingTop: 72 }}>
      <div role="dialog" aria-labelledby="fn-title" className="dialog finish">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 id="fn-title">Finish task {task.workItem?.id ?? task.name}</h2>
          <div className="muted">{task.workItem?.title ?? task.branch}</div>
        </div>

        <div className="finish-section">
          <div className="label">Safety checks</div>
          {!checks && !checksFailed && (
            <div className="muted">Checking{ELLIPSIS}</div>
          )}
          {checksFailed && (
            <div className="check check-warn">
              <span aria-hidden="true">{G.WARN}</span>
              <div className="body">{`Could not inspect the worktree: ${checksFailed}. You can still clean up.`}</div>
            </div>
          )}
          {checks &&
            (checks.uncommitted.length > 0 ? (
              <div className="check check-warn">
                <span aria-hidden="true">{G.WARN}</span>
                <div className="body">
                  <div className="title">{`${checks.uncommitted.length} uncommitted change${checks.uncommitted.length === 1 ? '' : 's'}`}</div>
                  <div className="mono small files">
                    {checks.uncommitted
                      .map((f) => `${f.status} ${f.path}`)
                      .join('\n')}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-warn btn-sm"
                  onClick={() =>
                    openGit('git commit', 'git add -A && git commit')
                  }
                >
                  Commit{ELLIPSIS}
                </button>
              </div>
            ) : (
              <div className="check check-ok">
                <span aria-hidden="true">{G.OK}</span>
                <div className="body">No uncommitted changes</div>
              </div>
            ))}
          {checks &&
            (checks.unpushed > 0 ? (
              <div className="check check-warn">
                <span aria-hidden="true">{G.UP}</span>
                <div className="body">
                  <div className="title">{`${checks.unpushed} commit${checks.unpushed === 1 ? '' : 's'} not pushed`}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-warn btn-sm"
                  onClick={() =>
                    openGit('git push', `git push -u origin ${task.branch}`)
                  }
                >
                  Push
                </button>
              </div>
            ) : (
              <div className="check check-ok">
                <span aria-hidden="true">{G.OK}</span>
                <div className="body">Nothing to push</div>
              </div>
            ))}
          {checks &&
            (checks.runningTerminals > 0 ? (
              <div className="check check-warn">
                <span aria-hidden="true">{G.PLAY}</span>
                <div className="body">
                  <div className="title">{`${checks.runningTerminals} terminal${checks.runningTerminals === 1 ? '' : 's'} still running`}</div>
                  <div className="small">
                    They are closed when you finish, unless you untick it below.
                  </div>
                </div>
              </div>
            ) : (
              <div className="check check-ok">
                <span aria-hidden="true">{G.OK}</span>
                <div className="body">
                  No running processes besides this task's terminals
                </div>
              </div>
            ))}
        </div>

        <div className="finish-section">
          <div className="label">AI usage</div>
          {usage && usage.sessions.length > 0 ? (
            <div>
              <div className="amount-line">{`${eur(usage.billable.costEur)} billable`}</div>
              {(['claude-code', 'copilot-cli'] as const)
                .filter((t) => usage.byTool[t].sessions > 0)
                .map((t) => (
                  <div
                    key={t}
                    className="small muted"
                  >{`${t === 'claude-code' ? 'Claude Code' : 'Copilot CLI'} ${eur(usage.byTool[t].costEur)} over ${usage.byTool[t].sessions} session${usage.byTool[t].sessions === 1 ? '' : 's'}`}</div>
                ))}
            </div>
          ) : (
            <div className="muted">No AI usage captured for this task.</div>
          )}
          {canSync && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={syncUsage}
                onChange={(e) => setSyncUsage(e.target.checked)}
              />
              Write final totals to the work item and add a usage comment
            </label>
          )}
        </div>

        <div className="finish-section">
          <div className="label">Clean up</div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={closeTerminals && nTerm > 0}
              disabled={nTerm === 0}
              onChange={(e) => setCloseTerminals(e.target.checked)}
            />
            {`Close ${nTerm} terminal${nTerm === 1 ? '' : 's'}${nTerm > 0 ? ` (${terminalLabels})` : ''}`}
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={removeWorktree}
              onChange={(e) => setRemoveWorktree(e.target.checked)}
            />
            Remove worktree folder
          </label>
          {!removeWorktree && deleteBranch && (
            <div className="muted small">
              The branch cannot be deleted while its worktree folder exists.
              Tick &quot;Remove worktree folder&quot; too, or untick this.
            </div>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={deleteBranch}
              onChange={(e) => setDeleteBranch(e.target.checked)}
            />
            Delete local branch{' '}
            <span className="mono small">{task.branch}</span>
          </label>
        </div>

        <div className="finish-foot">
          <button
            type="button"
            className="btn"
            onClick={() => go({ kind: 'workspace' })}
          >
            Keep task
          </button>
          <button
            type="button"
            className={dirty ? 'btn btn-danger' : 'btn btn-green'}
            disabled={busy || (!checks && !checksFailed)}
            onClick={finish}
          >
            {checksFailed
              ? 'Clean up without checks'
              : dirty
                ? 'Discard changes and clean up'
                : 'Finish and clean up'}
          </button>
        </div>
      </div>
    </div>
  );
}
