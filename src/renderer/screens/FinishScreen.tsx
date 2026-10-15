import { useEffect, useState } from 'react';
import type { FinishChecks } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { eur } from '../format';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { PageHeader } from '../components/ui';
import { useEscape } from '../hooks/useEscape';
import { useStore } from '../store';
import { readPrChoice, writePrChoice } from '../uiPrefs';

const ELLIPSIS = String.fromCharCode(0x2026);
const PR_FAILED = 'Pull request not created: ';
const G = {
  WARN: String.fromCharCode(0x26a0),
  OK: String.fromCharCode(0x2713),
  UP: String.fromCharCode(0x2191),
  PLAY: String.fromCharCode(0x25b6),
};

export function FinishScreen({ taskId }: { taskId: string }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const go = useStore((s) => s.go);
  const back = useStore((s) => s.back);
  const select = useStore((s) => s.select);
  const notify = useStore((s) => s.notify);
  const [checks, setChecks] = useState<FinishChecks | null>(null);
  const [closeTerminals, setCloseTerminals] = useState(true);
  const [removeWorktree, setRemoveWorktree] = useState(true);
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checksFailed, setChecksFailed] = useState<string | null>(null);
  const [pr, setPr] = useState<{
    available: boolean;
    reason: string | null;
    target: string | null;
  } | null>(null);
  // MIAC asks every time: unchecked until the user has chosen once for this repo.
  const [prChoice, setPrChoice] = useState(() =>
    readPrChoice(task?.repoId ?? ''),
  );
  const [finishError, setFinishError] = useState<string | null>(null);
  const ready = task?.status === 'ready';
  const usage = useTaskUsage(ready ? taskId : null);
  const repo = useStore((s) => s.repos.find((r) => r.id === task?.repoId));
  const canSync = Boolean(task?.workItem) && Boolean(repo?.connectionId);
  // Untouched (null) defaults to on, except when no usage was captured.
  const [syncChoice, setSyncUsage] = useState<boolean | null>(null);
  const syncUsage = syncChoice ?? !(usage && usage.sessions.length === 0);

  const loadChecks = async (isLive: () => boolean) => {
    const c = await tryInvoke(async () => {
      try {
        return await api().invoke('tasks:finishChecks', taskId);
      } catch (e) {
        if (isLive()) {
          setChecks(null);
          setChecksFailed(e instanceof Error ? e.message : 'unknown error');
        }
        throw e;
      }
    }, notify);
    if (isLive() && c) {
      setChecks(c);
      setChecksFailed(null);
    }
    return c ?? null;
  };

  useEffect(() => {
    if (!ready) return;
    let live = true;
    void loadChecks(() => live);
    void tryInvoke(
      () => api().invoke('tasks:prAvailability', taskId),
      notify,
    ).then((a) => {
      if (live && a) setPr(a);
    });
    return () => {
      live = false;
    };
    // loadChecks only closes over taskId and notify, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, notify, ready]);

  useEscape(back);

  const stillHere = () => {
    const now = useStore.getState().screen;
    return now.kind === 'finish' && now.taskId === taskId;
  };

  if (!task) return null;

  if (!ready) {
    return (
      <div className="page">
        <PageHeader title="Finish task" />
        <div className="page-body finish">
          <div className="muted">{`This task is ${task.status}. Finish it once setup has succeeded; use the Setup screen to retry or remove it.`}</div>
          <div className="finish-foot">
            <button type="button" className="btn" onClick={back}>
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
    if (opened && stillHere()) {
      select(taskId);
      go({ kind: 'task' });
    }
  };

  const createPr = Boolean(pr?.available && prChoice);

  /** Whether finishing without the PR path would discard work, exactly as the main button judges it. */
  const dirtyWith = (
    c: FinishChecks | null,
    failed: boolean,
    withPr: boolean,
  ) =>
    failed
      ? true
      : c
        ? c.uncommitted.length > 0 || (c.unpushed > 0 && !withPr)
        : false;

  const finish = async (withoutPr = false) => {
    const withPr = createPr && !withoutPr;
    setBusy(true);
    setFinishError(null);
    // The choice is saved when Finish is clicked, not on every toggle.
    if (pr?.available && !withoutPr) writePrChoice(task.repoId, prChoice);
    let prFailed = false;
    const ok = await tryInvoke(async () => {
      try {
        await api().invoke('tasks:finish', taskId, {
          closeTerminals: closeTerminals && nTerm > 0,
          removeWorktree,
          deleteBranch,
          syncUsage: canSync && syncUsage,
          createPullRequest: withPr,
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : '';
        if (!m.includes(PR_FAILED)) throw e;
        prFailed = true;
        setFinishError(m.slice(m.indexOf(PR_FAILED)));
        return false;
      }
      return true;
    }, notify);
    // A push that went through changes what is unpushed; the fallback below must judge fresh checks.
    if (prFailed) await loadChecks(stillHere);
    setBusy(false);
    // Only when the user is still here: Escape or the nav may have taken them elsewhere meanwhile.
    if (ok && stillHere()) {
      select(taskId);
      go({ kind: 'task' });
    }
  };

  /**
   * Without the PR, unpushed commits are a risk again. When dropping the PR would discard work, untick
   * the box instead of finishing: the page then shows the same warnings and danger button as a normal
   * Finish, and that button is the confirmation.
   */
  const finishWithoutPr = async () => {
    if (dirtyWith(checks, Boolean(checksFailed), false)) {
      setPrChoice(false);
      setFinishError(null);
      return;
    }
    await finish(true);
  };

  const dirty = dirtyWith(checks, Boolean(checksFailed), createPr);
  const nTerm = task.terminals.length;
  const terminalLabels = task.terminals.map((t) => t.label).join(', ');

  return (
    <div className="page">
      <PageHeader title="Finish task" />
      <div className="page-body finish">
        <div className="muted">
          {task.workItem
            ? `${task.workItem.type} ${task.workItem.id} ${task.workItem.title}`
            : task.name}{' '}
          <span className="mono small">{task.branch}</span>
        </div>

        <div className="finish-section">
          <h2>Safety checks</h2>
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
            (checks.unpushed > 0 && !createPr ? (
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
            ) : checks.unpushed > 0 ? (
              <div className="check check-ok">
                <span aria-hidden="true">{G.UP}</span>
                <div className="body">
                  {`${checks.unpushed} commit${checks.unpushed === 1 ? '' : 's'} will be pushed for the pull request`}
                </div>
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
          <h2>AI usage</h2>
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
          <h2>Clean up</h2>
          {pr && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={createPr}
                disabled={!pr.available}
                onChange={(e) => {
                  setPrChoice(e.target.checked);
                  // A stale error's Retry would otherwise run with the new choice and no fresh look.
                  setFinishError(null);
                }}
              />
              {pr.available
                ? `Create a draft pull request into ${pr.target}`
                : 'Create a draft pull request'}
              {!pr.available && pr.reason && (
                <>
                  {' '}
                  <span className="muted small">{pr.reason}</span>
                </>
              )}
            </label>
          )}
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
          {removeWorktree && !closeTerminals && nTerm > 0 && (
            <div className="muted small">
              Removing the worktree folder closes its terminals too.
            </div>
          )}
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

        {finishError && (
          <div className="check check-warn" role="alert">
            <span aria-hidden="true">{G.WARN}</span>
            <div className="body">{finishError}</div>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => finish()}
            >
              Retry
            </button>
            <button
              type="button"
              className="btn btn-subtle btn-sm"
              disabled={busy}
              onClick={() => void finishWithoutPr()}
            >
              Finish without PR
            </button>
          </div>
        )}

        <div className="finish-foot">
          <button type="button" className="btn" onClick={back}>
            Keep task
          </button>
          <button
            type="button"
            className={dirty ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={busy || (!checks && !checksFailed)}
            onClick={() => finish()}
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
