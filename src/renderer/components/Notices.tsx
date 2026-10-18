import { useEffect, useState } from 'react';
import type { PendingUpdate } from '../../shared/ipc';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';
import { track } from '../telemetry';

/** A downloaded update, offered once per launch in the notice corner: no dialog, nothing to click unless wanted. */
function UpdateNotice() {
  const notify = useStore((s) => s.notify);
  const [update, setUpdate] = useState<PendingUpdate | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const off = api().on('update:ready', (u) => setUpdate(u));
    // The download may have finished before this window subscribed.
    void api()
      .invoke('update:status')
      .then((u) => {
        if (live && u) setUpdate(u);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      off();
    };
  }, []);

  if (!update || dismissed) return null;
  const name = update.version
    ? `Shellie ${update.version}`
    : 'A new version of Shellie';
  const restart = async () => {
    setBusy(true);
    const ok = await tryInvoke(async () => {
      await api().invoke('update:install');
      return true;
    }, notify);
    if (!ok) setBusy(false);
  };
  return (
    <div className="notice notice-update">
      <div className="notice-update-body">
        <strong>{name} is ready</strong>
        <span className="muted small">
          Restart to update now, or it installs the next time Shellie starts.
          Terminals close; Claude Code resumes its sessions after the restart.
        </span>
        <div className="notice-update-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={restart}
            disabled={busy}
          >
            Restart and update
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              track('update.later');
              setDismissed(true);
            }}
            disabled={busy}
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}

export function Notices() {
  const notices = useStore((s) => s.notices);
  const dismiss = useStore((s) => s.dismiss);
  return (
    <div className="notices" role="status">
      {notices.map((n) => (
        <div key={n.id} className={`notice notice-${n.level}`}>
          <span>{n.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(n.id)}
          >
            &times;
          </button>
        </div>
      ))}
      <UpdateNotice />
    </div>
  );
}
