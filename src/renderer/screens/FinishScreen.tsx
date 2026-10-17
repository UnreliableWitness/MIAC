import { useEffect, useState } from 'react';
import type {
  FinishChecks,
  FinishRowResult,
  WorkspaceAction,
  WorkspaceCheck,
} from '../../shared/types';
import {
  activeWorkspaces,
  dropsAtFinish,
  HOME_ID,
  taskConnectionId,
} from '../../shared/workspaces';
import { api, tryInvoke } from '../api';
import { eur } from '../format';
import { useTaskUsage } from '../hooks/useTaskUsage';
import { useWriteCostToAdo } from '../hooks/useWriteCostToAdo';
import { TimeSpentSection } from '../components/TimeSpentSection';
import { useEstimateHours } from '../hooks/useEstimateHours';
import { useTaskTime } from '../hooks/useTaskTime';
import { PageHeader } from '../components/ui';
import { useEscape } from '../hooks/useEscape';
import type { ReviewSummary } from '../../shared/review';
import { useStore } from '../store';
import {
  readPrChoice,
  readPushChoice,
  writePrChoice,
  writePushChoice,
} from '../uiPrefs';

const ELLIPSIS = String.fromCharCode(0x2026);
const PR_FAILED = 'Pull request not created: ';

type Choices = Record<string, boolean>;

/** No commits and a clean worktree: the wrong first guess, removed without a push by default. */
const noChanges = (c: WorkspaceCheck) =>
  dropsAtFinish({ ...c, uncommitted: c.uncommitted.length });

/**
 * A worktree on another branch than the task's (a long-lived `dev` joined by hand): Finish never removes it or its
 * branch, and pushes or opens a PR for it only when the user ticks that.
 */
const foreign = (c: WorkspaceCheck, taskBranch: string) =>
  c.branch !== taskBranch;

/** The row's checkbox: as the user set it, else its default (remove, or the last PR or push choice for the repo). */
const choiceOf = (
  c: WorkspaceCheck,
  choices: Choices,
  taskBranch: string,
): boolean =>
  choices[c.workspaceId] ??
  (foreign(c, taskBranch)
    ? false
    : noChanges(c)
      ? true
      : c.pr.available
        ? readPrChoice(c.repoId)
        : readPushChoice(c.repoId));

const actionOf = (
  c: WorkspaceCheck,
  choices: Choices,
  taskBranch: string,
): WorkspaceAction => {
  if (c.missing) return 'keep';
  if (foreign(c, taskBranch) && noChanges(c)) return 'keep';
  const on = choiceOf(c, choices, taskBranch);
  if (!on) return 'keep';
  return noChanges(c) ? 'drop' : c.pr.available ? 'pr' : 'push';
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
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
  const [review, setReview] = useState<ReviewSummary | null>(null);
  useEffect(() => {
    let live = true;
    void api()
      .invoke('review:summary', taskId)
      .then((r) => live && setReview(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [taskId]);
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
  // Finish waits for the PR availability, else a stored yes would be sent as no.
  const [prLoaded, setPrLoaded] = useState(false);
  // With several repos: each row's checkbox once the user touched it.
  const [rowChoice, setRowChoice] = useState<Choices>({});
  // Each row's outcome of a Finish that stopped before cleanup.
  const [results, setResults] = useState<FinishRowResult[] | null>(null);
  const ready = task?.status === 'ready';
  const usage = useTaskUsage(ready ? taskId : null);
  const repos = useStore((s) => s.repos);
  const writeCost = useWriteCostToAdo();
  const {
    time,
    error: timeError,
    reload: reloadTime,
  } = useTaskTime(ready ? taskId : null);
  // The work item's connection is the task's own; the home repo may have none or have been dropped.
  const connectionId = task ? taskConnectionId(task, repos) : null;
  const workItemId = task?.workItem?.id ?? null;
  const estimateHours = useEstimateHours(connectionId, workItemId, time, ready);
  // The starting value is fixed when the time first loads: a later refetch updates the marks, never the booking.
  const [frozenTime, setFrozenTime] = useState<number | undefined>();
  const [chosenTime, setChosenTime] = useState<number | null | undefined>();
  if (time && frozenTime === undefined)
    setFrozenTime(
      time.booking
        ? time.booking.bookedSeconds + time.measuredSinceReopenSeconds
        : time.activeSeconds,
    );
  const bookValue =
    chosenTime === undefined ? (frozenTime ?? null) : chosenTime;
  // Finish waits for the time (or an explicit "without booking"), and for a valid entry.
  const timeBlocks = !time || bookValue === null;
  const canSync =
    Boolean(task?.workItem) &&
    Boolean(task && taskConnectionId(task, repos)) &&
    writeCost === true;
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
      if (!live) return;
      if (a) setPr(a);
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

  const openGit = async (
    label: string,
    command: string,
    workspaceId?: string,
  ) => {
    const opened = await tryInvoke(
      () =>
        api().invoke('terminals:open', taskId, {
          kind: 'run',
          label,
          command,
          ...(workspaceId ? { workspaceId } : {}),
        }),
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

  const finish = async (withoutPr = false, withoutTime = false) => {
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
          ...(!withoutTime && time && bookValue !== null
            ? { bookedSeconds: bookValue }
            : {}),
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

  // A task with other repos finishes per workspace; a single-repo task keeps the page as it was. Repos dropped at
  // an earlier Finish do not count, but a dropped home does: the single-repo path works on the home.
  const multi = activeWorkspaces(task).length > 1 || task.homeDropped;
  const taskBranch = task.branch;
  const rows = checks?.workspaces ?? [];

  /** Whether finishing with these row choices would discard uncommitted work or unpushed commits. */
  const dirtyRows = (
    list: WorkspaceCheck[],
    failed: boolean,
    choices: Choices,
  ) =>
    failed ||
    list.some((c) => {
      const action = actionOf(c, choices, taskBranch);
      // A row on another branch is kept as is: nothing of it is discarded.
      if (c.missing || action === 'drop' || foreign(c, taskBranch))
        return false;
      return c.uncommitted.length > 0 || (c.unpushed > 0 && action === 'keep');
    });

  const finishRows = async (
    choices: Choices,
    withoutPr = false,
    withoutTime = false,
  ) => {
    setBusy(true);
    setFinishError(null);
    setResults(null);
    // The choices are saved when Finish is clicked; leaving out a failed PR is not a new preference.
    if (!withoutPr)
      for (const c of rows)
        if (!c.missing && !noChanges(c) && !foreign(c, taskBranch))
          (c.pr.available ? writePrChoice : writePushChoice)(
            c.repoId,
            choiceOf(c, choices, taskBranch),
          );
    const workspaces =
      rows.length > 0
        ? rows.map((c) => ({
            workspaceId: c.workspaceId,
            action: actionOf(c, choices, taskBranch),
          }))
        : // Without checks nothing is pushed: every workspace is kept and cleaned up per the options.
          activeWorkspaces(task).map((w) => ({
            workspaceId: w.id,
            action: 'keep' as const,
          }));
    let rowFailed = false;
    const ok = await tryInvoke(async () => {
      try {
        await api().invoke('tasks:finish', taskId, {
          closeTerminals: closeTerminals && nTerm > 0,
          removeWorktree,
          deleteBranch,
          syncUsage: canSync && syncUsage,
          workspaces,
          ...(!withoutTime && time && bookValue !== null
            ? { bookedSeconds: bookValue }
            : {}),
        });
      } catch (e) {
        // Main keeps each row's outcome; without a failed row this is another error, shown as a notice.
        const outcome = await api()
          .invoke('tasks:finishResults', taskId)
          .catch(() => null);
        const failed = outcome?.filter((r) => !r.ok) ?? [];
        if (!outcome || failed.length === 0) throw e;
        rowFailed = true;
        setResults(outcome);
        setFinishError(
          `Finish stopped before cleanup: ${plural(failed.length, 'repo')} failed. Nothing was removed.`,
        );
        return false;
      }
      return true;
    }, notify);
    // A push that went through changes what is unpushed; the fallback below must judge fresh checks.
    if (rowFailed) await loadChecks(stillHere);
    setBusy(false);
    if (ok && stillHere()) {
      select(taskId);
      go({ kind: 'task' });
    }
  };

  /** Like the single-repo Finish without PR, for the failed rows only: untick them, and finish if nothing is lost. */
  const finishRowsWithoutPr = async () => {
    const next = { ...rowChoice };
    for (const r of results ?? []) if (!r.ok) next[r.workspaceId] = false;
    setRowChoice(next);
    if (dirtyRows(rows, Boolean(checksFailed), next)) {
      setFinishError(null);
      setResults(null);
      return;
    }
    await finishRows(next, true);
  };

  const setRow = (id: string, on: boolean) => {
    setRowChoice((c) => ({ ...c, [id]: on }));
    // A stale error's Retry would otherwise run with the new choice and no fresh look.
    setFinishError(null);
    setResults(null);
  };

  /** After the task's repos changed, the rows are judged again from fresh checks. */
  const reloadRows = async () => {
    setFinishError(null);
    setResults(null);
    await loadChecks(stillHere);
  };

  const addWorktree = async () => {
    const folder = await tryInvoke(
      () => api().invoke('repos:pickFolder'),
      notify,
    );
    if (!folder) return;
    const added = await tryInvoke(
      () => api().invoke('tasks:addWorkspace', taskId, folder),
      notify,
    );
    if (added) await reloadRows();
  };

  const removeRow = async (workspaceId: string) => {
    const removed = await tryInvoke(async () => {
      await api().invoke('tasks:removeWorkspace', taskId, workspaceId);
      return true;
    }, notify);
    if (removed) await reloadRows();
  };

  const dirty = multi
    ? dirtyRows(rows, Boolean(checksFailed), rowChoice)
    : dirtyWith(checks, Boolean(checksFailed), createPr);
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
          {review && (review.notViewed > 0 || review.unresolved > 0) && (
            <div className="check check-warn">
              <span aria-hidden="true">{G.WARN}</span>
              <div className="body">
                {[
                  review.notViewed > 0 &&
                    `${review.notViewed} ${review.notViewed === 1 ? 'file' : 'files'} not viewed`,
                  review.unresolved > 0 &&
                    `${review.unresolved} ${review.unresolved === 1 ? 'comment' : 'comments'} unresolved`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => useStore.getState().openChanges(taskId)}
              >
                Review changes
              </button>
            </div>
          )}
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
            multi &&
            rows.map((c) => (
              <WorkspaceRow
                key={c.workspaceId}
                check={c}
                on={choiceOf(c, rowChoice, taskBranch)}
                action={actionOf(c, rowChoice, taskBranch)}
                otherBranch={foreign(c, taskBranch)}
                onToggle={(on) => setRow(c.workspaceId, on)}
                openGit={openGit}
                result={results?.find((r) => r.workspaceId === c.workspaceId)}
                busy={busy}
                onRemove={
                  c.workspaceId === HOME_ID
                    ? undefined
                    : () => void removeRow(c.workspaceId)
                }
              />
            ))}
          {(checks || checksFailed) && (
            <div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => void addWorktree()}
              >
                Add a worktree{ELLIPSIS}
              </button>
            </div>
          )}
          {checks &&
            !multi &&
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
            !multi &&
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

        {time ? (
          <TimeSpentSection
            task={task}
            time={time}
            estimateHours={estimateHours}
            value={bookValue}
            onChange={setChosenTime}
          />
        ) : (
          <div className="finish-section">
            <h2>Time spent</h2>
            {timeError ? (
              <div className="check check-warn" role="alert">
                <span aria-hidden="true">{G.WARN}</span>
                <div className="body">Time could not be loaded</div>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={reloadTime}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="btn btn-subtle btn-sm"
                  disabled={
                    busy || (!multi && !prLoaded) || (!checks && !checksFailed)
                  }
                  onClick={() =>
                    multi
                      ? void finishRows(rowChoice, false, true)
                      : void finish(false, true)
                  }
                >
                  Finish without booking time
                </button>
              </div>
            ) : (
              <div className="muted">Loading time{ELLIPSIS}</div>
            )}
          </div>
        )}

        <div className="finish-section">
          <h2>Clean up</h2>
          {pr && !multi && (
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
            {multi ? 'Remove worktree folders' : 'Remove worktree folder'}
          </label>
          {removeWorktree && !closeTerminals && nTerm > 0 && (
            <div className="muted small">
              Removing the worktree folder closes its terminals too.
            </div>
          )}
          {multi &&
            !removeWorktree &&
            !closeTerminals &&
            nTerm > 0 &&
            rows.some((c) => actionOf(c, rowChoice, taskBranch) === 'drop') && (
              <div className="muted small">
                Removing a repo without changes closes the terminals too.
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
            {multi ? (
              'Delete local branches'
            ) : (
              <>
                Delete local branch{' '}
                <span className="mono small">{task.branch}</span>
              </>
            )}
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
              onClick={() =>
                multi ? void finishRows(rowChoice) : void finish()
              }
            >
              Retry
            </button>
            <button
              type="button"
              className="btn btn-subtle btn-sm"
              disabled={busy}
              onClick={() =>
                multi ? void finishRowsWithoutPr() : void finishWithoutPr()
              }
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
              busy ||
              (!multi && !prLoaded) ||
              timeBlocks ||
              (!checks && !checksFailed)
            }
            onClick={() => (multi ? void finishRows(rowChoice) : void finish())}
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

/** One repo of a task on the Finish page: what it holds and what Finish will do with it. */
function WorkspaceRow({
  check: c,
  on,
  action,
  onToggle,
  openGit,
  result,
  busy,
  onRemove,
  otherBranch,
}: {
  check: WorkspaceCheck;
  on: boolean;
  action: WorkspaceAction;
  /** Not on the task's branch: kept as is, never removed; push or PR only when ticked. */
  otherBranch: boolean;
  onToggle: (on: boolean) => void;
  openGit: (label: string, command: string, workspaceId?: string) => void;
  /** What the last Finish did with this row, when it stopped before cleanup. */
  result?: FinishRowResult;
  busy: boolean;
  /** Absent for the home workspace, which stays in the task. */
  onRemove?: () => void;
}) {
  const done = result?.ok
    ? result.pullRequest
      ? `Pull request #${result.pullRequest.id} ${result.pullRequest.linked ? 'linked' : 'created'}`
      : result.action === 'push' && result.pushed
        ? 'Pushed'
        : null
    : null;
  return (
    <div className="finish-workspace" role="group" aria-label={c.repoName}>
      <div className="finish-workspace-head">
        <strong>{c.repoName}</strong>{' '}
        <span className="mono small">{c.branch}</span>{' '}
        {!c.missing && (
          <span className="muted small">
            {c.commits > 0
              ? plural(c.commits, 'commit')
              : c.baseKnown
                ? 'No commits'
                : 'Changes unknown'}
          </span>
        )}
        {onRemove && (
          <button
            type="button"
            className="btn btn-subtle btn-sm"
            disabled={busy}
            onClick={onRemove}
          >
            Remove from task
          </button>
        )}
      </div>
      {done && (
        <div className="check check-ok">
          <span aria-hidden="true">{G.OK}</span>
          <div className="body">{done}</div>
        </div>
      )}
      {result && !result.ok && (
        <div className="check check-warn">
          <span aria-hidden="true">{G.WARN}</span>
          <div className="body">{result.error}</div>
        </div>
      )}
      {c.missing ? (
        <div className="muted small">Folder missing, skipped</div>
      ) : (
        <>
          {c.uncommitted.length > 0 && (
            <div className="check check-warn">
              <span aria-hidden="true">{G.WARN}</span>
              <div className="body">
                <div className="title">
                  {plural(c.uncommitted.length, 'uncommitted change')}
                </div>
                <div className="mono small files">
                  {c.uncommitted.map((f) => `${f.status} ${f.path}`).join('\n')}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-warn btn-sm"
                onClick={() =>
                  openGit(
                    'git commit',
                    'git add -A && git commit',
                    c.workspaceId,
                  )
                }
              >
                Commit{ELLIPSIS}
              </button>
            </div>
          )}
          {otherBranch && (
            <div className="muted small">{`Not this task's branch (${c.branch}): kept as is`}</div>
          )}
          {c.unpushed > 0 && action === 'keep' && !otherBranch && (
            <div className="check check-warn">
              <span aria-hidden="true">{G.UP}</span>
              <div className="body">
                <div className="title">{`${plural(c.unpushed, 'commit')} not pushed`}</div>
              </div>
              <button
                type="button"
                className="btn btn-warn btn-sm"
                onClick={() =>
                  openGit(
                    'git push',
                    `git push -u origin ${c.branch}`,
                    c.workspaceId,
                  )
                }
              >
                Push
              </button>
            </div>
          )}
          {!(otherBranch && noChanges(c)) && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => onToggle(e.target.checked)}
              />
              {noChanges(c)
                ? 'Remove, no changes (no push)'
                : c.pr.available
                  ? `Create a draft pull request into ${c.pr.target}`
                  : 'Push the branch'}
            </label>
          )}
          {!noChanges(c) && !c.pr.available && c.pr.reason && (
            <div className="muted small">{`No pull request: ${c.pr.reason}`}</div>
          )}
          {!noChanges(c) && c.pr.available && !c.pr.linksWorkItem && (
            <div className="muted small">
              This repo is in another organization: the PR names the work item
              instead of linking it.
            </div>
          )}
        </>
      )}
    </div>
  );
}
