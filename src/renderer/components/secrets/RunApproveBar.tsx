import { Warning16Filled } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { ENVIRONMENT_LABEL, type PendingRun } from '../../../shared/secrets';
import { api, tryInvoke } from '../../api';
import { useStore } from '../../store';

/** Bidi overrides and isolates (U+202A-U+202E, U+2066-U+2069) shown as `<U+202E>`: they can make text read differently. */
const visible = (text: string) =>
  text.replace(
    /[\u202a-\u202e\u2066-\u2069]/g,
    (c) => `<U+${c.codePointAt(0)!.toString(16).toUpperCase()}>`,
  );

/** The command line as the developer reads it: arguments with spaces or quotes shown quoted. */
const commandLine = (r: PendingRun) =>
  visible(
    [
      r.command,
      ...r.args.map((a) => (/[\s"']|^$/.test(a) ? JSON.stringify(a) : a)),
    ]
      .filter((p) => p !== '')
      .join(' '),
  );

/**
 * On UAT and Production every `shellie run` waits here: which named command an agent asks to run, with which
 * arguments and secrets, and Approve or Refuse. A refuse tells the agent "Not approved in Shellie". It shows what
 * really runs (the package.json scripts behind `npm test`, pre and post too), since an agent can edit that script in the worktree.
 */
export function RunApproveBar({ taskId }: { taskId: string }) {
  const notify = useStore((s) => s.notify);
  const [pending, setPending] = useState<PendingRun[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let heard = false;
    const off = api().on('runs:pending', (list) => {
      heard = true;
      setPending(list);
    });
    void api()
      .invoke('runs:pending')
      .then((list) => {
        // An event that came first is newer than this answer.
        if (live && !heard) setPending(list);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      off();
    };
  }, []);

  const mine = pending.filter((r) => r.taskId === taskId);
  if (mine.length === 0) return null;

  const answer = async (id: string, ok: boolean) => {
    setBusy(id);
    await tryInvoke(() => api().invoke('runs:approve', id, ok), notify);
    setBusy(null);
  };

  return (
    <>
      {mine.map((r) => (
        <div
          key={r.id}
          role="alert"
          className={`run-approve run-approve-${r.environment}`}
        >
          <Warning16Filled aria-hidden="true" />
          <span className="run-approve-text">
            {`An agent asks to run ${r.name} with ${ENVIRONMENT_LABEL[r.environment]} secrets`}
          </span>
          <code className="run-approve-command">{commandLine(r)}</code>
          {r.scripts !== undefined && (
            <>
              <span>runs the scripts</span>
              {r.scripts.map((sc) => (
                <code key={sc.name} className="run-approve-command">
                  {visible(`${sc.name}: ${sc.text}`)}
                </code>
              ))}
            </>
          )}
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={busy === r.id}
            onClick={() => void answer(r.id, true)}
          >
            Approve
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy === r.id}
            onClick={() => void answer(r.id, false)}
          >
            Refuse
          </button>
          <span className="run-approve-note">
            Files in this worktree changed since the base can change what this
            runs.
          </span>
        </div>
      ))}
    </>
  );
}
