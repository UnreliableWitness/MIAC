import { useEffect, useState } from 'react';
import type { FinishChecks } from '../../shared/types';
import { api, tryInvoke } from '../api';
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

  useEffect(() => {
    let live = true;
    void tryInvoke(
      () => api().invoke('tasks:finishChecks', taskId),
      notify,
    ).then((c) => {
      if (live && c) setChecks(c);
    });
    return () => {
      live = false;
    };
  }, [taskId, notify]);

  if (!task) return null;

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
        closeTerminals,
        removeWorktree,
        deleteBranch,
      });
      return true;
    }, notify);
    setBusy(false);
    if (ok) go({ kind: 'workspace' });
  };

  const dirty = checks
    ? checks.uncommitted.length > 0 || checks.unpushed > 0
    : false;
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
          {!checks && <div className="muted">Checking{ELLIPSIS}</div>}
          {checks &&
            (checks.uncommitted.length > 0 ? (
              <div className="check check-warn">
                <span aria-hidden="true">{G.WARN}</span>
                <div className="body">
                  <div className="title">{`${checks.uncommitted.length} uncommitted change${checks.uncommitted.length === 1 ? '' : 's'}`}</div>
                  <div className="mono small">
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
          <div className="label">Clean up</div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={closeTerminals}
              onChange={(e) => setCloseTerminals(e.target.checked)}
            />
            {`Close ${task.terminals.length} terminals (${terminalLabels})`}
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={removeWorktree}
              onChange={(e) => setRemoveWorktree(e.target.checked)}
            />
            Remove worktree folder
          </label>
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
            disabled={busy || !checks}
            onClick={finish}
          >
            {dirty ? 'Discard changes and clean up' : 'Finish and clean up'}
          </button>
        </div>
      </div>
    </div>
  );
}
