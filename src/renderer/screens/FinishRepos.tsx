import { useEffect, useState } from 'react';
import type { Channels } from '../../shared/ipc';
import { worktreesOf } from '../../shared/tasks';
import type { FinishChecks } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { PageHeader } from '../components/ui';
import { eur } from '../format';
import { useEscape } from '../hooks/useEscape';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { useWriteCostToAdo } from '../hooks/useWriteCostToAdo';
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
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

type Availability = Channels['tasks:prAvailability']['result'];

/** Finish for a task folder with several repos: checks, a draft pull request choice and cleanup per repo. */
export function FinishRepos({ taskId }: { taskId: string }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const go = useStore((s) => s.go);
  const back = useStore((s) => s.back);
  const select = useStore((s) => s.select);
  const notify = useStore((s) => s.notify);
  const homeRepo = useStore((s) => s.repos.find((r) => r.id === task?.repoId));
  const [checks, setChecks] = useState<FinishChecks | null>(null);
  const [checksFailed, setChecksFailed] = useState<string | null>(null);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [prLoaded, setPrLoaded] = useState(false);
  // Untouched repos follow the last Finish of that repo (unticked until chosen once).
  const [choice, setChoice] = useState<Record<string, boolean>>({});
  const [closeTerminals, setCloseTerminals] = useState(true);
  const [removeWorktree, setRemoveWorktree] = useState(true);
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const ready = task?.status === 'ready';
  const usage = useTaskUsage(ready ? taskId : null);
  const writeCost = useWriteCostToAdo();
  const canSync =
    Boolean(task?.workItem) &&
    Boolean(homeRepo?.connectionId) &&
    writeCost === true;
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
  };

  useEffect(() => {
    if (!ready) return;
    let live = true;
    void loadChecks(() => live);
    void tryInvoke(
      () => api().invoke('tasks:prAvailability', taskId),
      notify,
    ).then((a) => {
      if (!live) return;
      if (a) setAvail(a);
      setPrLoaded(true);
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
  if (!ready)
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

  const repos = worktreesOf(task).map((w) => ({
    w,
    check: checks?.repos?.find((r) => r.repoId === w.repoId) ?? null,
    pr: avail?.repos?.find((r) => r.repoId === w.repoId) ?? null,
  }));
  type Row = (typeof repos)[number];
  /** Only a repo with commits gets a PR, and only where pull requests are available. */
  const canPr = (r: Row) =>
    Boolean(r.pr?.available) && (r.check?.commits ?? 0) > 0;
  const wantsPr = (r: Row) =>
    canPr(r) && (choice[r.w.repoId] ?? readPrChoice(r.w.repoId));
  const prRepos = repos.filter(wantsPr).map((r) => r.w.repoId);
  const settingUp = repos.some((r) => r.w.status === 'setting-up');

  const dirtyWith = (withPr: string[]) =>
    checksFailed
      ? true
      : repos.some(
          (r) =>
            r.check &&
            (r.check.uncommitted.length > 0 ||
              (r.check.unpushed > 0 && !withPr.includes(r.w.repoId))),
        );

  const openGit = async (repoId: string, label: string, command: string) => {
    const opened = await tryInvoke(
      () =>
        api().invoke('terminals:open', taskId, {
          kind: 'run',
          label,
          command,
          repoId,
        }),
      notify,
    );
    if (opened && stillHere()) {
      select(taskId);
      go({ kind: 'task' });
    }
  };

  const nTerm = task.terminals.length;
  const terminalLabels = task.terminals.map((t) => t.label).join(', ');

  const finish = async (withoutPr = false) => {
    setBusy(true);
    setFinishError(null);
    // The choice is saved when Finish is clicked, not on every toggle.
    if (!withoutPr)
      for (const r of repos)
        if (canPr(r)) writePrChoice(r.w.repoId, wantsPr(r));
    let prFailed = false;
    const ok = await tryInvoke(async () => {
      try {
        await api().invoke('tasks:finish', taskId, {
          closeTerminals: closeTerminals && nTerm > 0,
          removeWorktree,
          deleteBranch,
          syncUsage: canSync && syncUsage,
          pullRequestRepos: withoutPr ? [] : prRepos,
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
    if (prFailed) await loadChecks(stillHere);
    setBusy(false);
    if (ok && stillHere()) {
      select(taskId);
      go({ kind: 'task' });
    }
  };

  /** Without the PRs, unpushed commits are a risk again: untick them so the page shows the warnings first. */
  const finishWithoutPr = async () => {
    if (dirtyWith([])) {
      setChoice(Object.fromEntries(repos.map((r) => [r.w.repoId, false])));
      setFinishError(null);
      return;
    }
    await finish(true);
  };

  const dirty = dirtyWith(prRepos);

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
          {settingUp && (
            <div className="check check-warn">
              <span aria-hidden="true">{G.WARN}</span>
              <div className="body">
                A repo is still being added. Wait for it, or remove it on the
                Repos page, then finish.
              </div>
            </div>
          )}
          {!checks && !checksFailed && (
            <div className="muted">Checking{ELLIPSIS}</div>
          )}
          {checksFailed && (
            <div className="check check-warn">
              <span aria-hidden="true">{G.WARN}</span>
              <div className="body">{`Could not inspect the worktrees: ${checksFailed}. You can still clean up.`}</div>
            </div>
          )}
          {checks &&
            repos.map((r) =>
              r.check ? (
                <section
                  key={r.w.repoId}
                  aria-label={`Checks for ${r.w.dir}`}
                  className="finish-repo"
                >
                  <h3 className="mono">{r.w.dir}/</h3>
                  {r.check.uncommitted.length > 0 ? (
                    <div className="check check-warn">
                      <span aria-hidden="true">{G.WARN}</span>
                      <div className="body">
                        <div className="title">{`${plural(r.check.uncommitted.length, 'uncommitted change')}`}</div>
                        <div className="mono small files">
                          {r.check.uncommitted
                            .map((f) => `${f.status} ${f.path}`)
                            .join('\n')}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-warn btn-sm"
                        aria-label={`Commit in ${r.w.dir}`}
                        onClick={() =>
                          openGit(
                            r.w.repoId,
                            'git commit',
                            'git add -A && git commit',
                          )
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
                  )}
                  {r.check.unpushed > 0 && !prRepos.includes(r.w.repoId) ? (
                    <div className="check check-warn">
                      <span aria-hidden="true">{G.UP}</span>
                      <div className="body">
                        <div className="title">{`${plural(r.check.unpushed, 'commit')} not pushed`}</div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-warn btn-sm"
                        aria-label={`Push ${r.w.dir}`}
                        onClick={() =>
                          openGit(
                            r.w.repoId,
                            'git push',
                            `git push -u origin ${r.w.branch}`,
                          )
                        }
                      >
                        Push
                      </button>
                    </div>
                  ) : r.check.unpushed > 0 ? (
                    <div className="check check-ok">
                      <span aria-hidden="true">{G.UP}</span>
                      <div className="body">
                        {`${plural(r.check.unpushed, 'commit')} will be pushed for the pull request`}
                      </div>
                    </div>
                  ) : (
                    <div className="check check-ok">
                      <span aria-hidden="true">{G.OK}</span>
                      <div className="body">Nothing to push</div>
                    </div>
                  )}
                </section>
              ) : null,
            )}
          {checks &&
            (checks.runningTerminals > 0 ? (
              <div className="check check-warn">
                <span aria-hidden="true">{G.PLAY}</span>
                <div className="body">
                  <div className="title">{`${plural(checks.runningTerminals, 'terminal')} still running`}</div>
                  <div className="small">
                    They are closed when you finish, unless you untick it below.
                  </div>
                </div>
              </div>
            ) : (
              <div className="check check-ok">
                <span aria-hidden="true">{G.OK}</span>
                <div className="body">
                  No running processes besides this task&apos;s terminals
                </div>
              </div>
            ))}
        </div>

        <div className="finish-section">
          <h2>AI usage</h2>
          {usage && usage.sessions.length > 0 ? (
            <div>
              <div className="amount-line">{`${eur(usage.billable.costEur)} billable`}</div>
              <div className="small muted">
                One amount for the whole task, across its repos.
              </div>
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
          {avail &&
            repos.map((r) => (
              <label key={r.w.repoId} className="checkbox">
                <input
                  type="checkbox"
                  checked={wantsPr(r)}
                  disabled={!canPr(r)}
                  onChange={(e) => {
                    const { checked } = e.target;
                    setChoice((prev) => ({ ...prev, [r.w.repoId]: checked }));
                    setFinishError(null);
                  }}
                />
                {r.pr?.available
                  ? `Create a draft pull request for ${r.w.dir} into ${r.pr.target}`
                  : `Create a draft pull request for ${r.w.dir}`}
                {r.pr && !r.pr.available && r.pr.reason && (
                  <>
                    {' '}
                    <span className="muted small">{r.pr.reason}</span>
                  </>
                )}
                {r.pr?.available && r.check && r.check.commits === 0 && (
                  <>
                    {' '}
                    <span className="muted small">no commits</span>
                  </>
                )}
              </label>
            ))}
          {prRepos.length > 0 && (
            <div className="muted small">
              Each pull request is linked to the work item and names the other
              repos.
            </div>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={closeTerminals && nTerm > 0}
              disabled={nTerm === 0}
              onChange={(e) => setCloseTerminals(e.target.checked)}
            />
            {`Close ${plural(nTerm, 'terminal')}${nTerm > 0 ? ` (${terminalLabels})` : ''}`}
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={removeWorktree}
              onChange={(e) => setRemoveWorktree(e.target.checked)}
            />
            Remove the worktree folders and the task folder
          </label>
          {!removeWorktree && deleteBranch && (
            <div className="muted small">
              The branches cannot be deleted while their worktree folders exist.
              Tick &quot;Remove the worktree folders&quot; too, or untick this.
            </div>
          )}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={deleteBranch}
              onChange={(e) => setDeleteBranch(e.target.checked)}
            />
            {`Delete the local branch in all ${repos.length} repos`}{' '}
            <span className="mono small">{task.branch}</span>
          </label>
        </div>

        {finishError && (
          <div className="check check-warn" role="alert">
            <span aria-hidden="true">{G.WARN}</span>
            <div className="body">
              {finishError}
              <div className="small muted">
                Pull requests made before this one are kept; Retry goes on with
                the rest.
              </div>
            </div>
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
            disabled={
              busy || settingUp || !prLoaded || (!checks && !checksFailed)
            }
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
