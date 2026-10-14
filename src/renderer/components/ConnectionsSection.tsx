import { useState } from 'react';
import type { Connection } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';

export function statusText(c: Connection): { text: string; ok: boolean } {
  switch (c.status) {
    case 'ok':
      return { text: `Connected as ${c.user ?? 'unknown user'}`, ok: true };
    case 'unauthorized':
      return { text: 'Token rejected, enter it again', ok: false };
    case 'unreachable':
      return { text: 'Organization unreachable', ok: false };
    default:
      return { text: 'Not verified yet', ok: false };
  }
}

function ConnectionRow({ connection }: { connection: Connection }) {
  const notify = useStore((s) => s.notify);
  const setConnections = useStore((s) => s.setConnections);
  const repos = useStore((s) => s.repos);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const users = repos.filter((r) => r.connectionId === connection.id).length;
  const status = statusText(connection);

  const refresh = async () =>
    setConnections(await api().invoke('connections:list'));
  const verify = async () => {
    setBusy(true);
    await tryInvoke(
      () => api().invoke('connections:verify', connection.id),
      notify,
    );
    await refresh();
    setBusy(false);
  };
  const remove = async () => {
    if (users > 0 && !confirming) return setConfirming(true);
    setBusy(true);
    const ok = await tryInvoke(async () => {
      await api().invoke('connections:remove', connection.id);
      return true;
    }, notify);
    setBusy(false);
    setConfirming(false);
    if (ok) await refresh();
  };

  return (
    <>
      <div className="list-row">
        <div className="grow">
          <span style={{ fontWeight: 600 }}>{connection.name}</span>
          <span className="mono small muted">
            {connection.organizationUrl} &middot; {connection.project}
          </span>
          <span className={status.ok ? 'conn-status-ok' : 'conn-status-bad'}>
            {status.text}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={verify}
          disabled={busy}
        >
          Verify
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={remove}
          disabled={busy}
        >
          Remove
        </button>
      </div>
      {confirming && (
        <div className="conn-confirm">
          <span>{`${users} ${users === 1 ? 'repository uses' : 'repositories use'} this connection; they will be unlinked.`}</span>
          <button
            type="button"
            className="btn btn-warn btn-sm"
            onClick={remove}
          >
            Remove anyway
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setConfirming(false)}
          >
            Keep
          </button>
        </div>
      )}
    </>
  );
}

function AddConnectionForm({ onDone }: { onDone: () => void }) {
  const setConnections = useStore((s) => s.setConnections);
  const [organizationUrl, setOrganizationUrl] = useState('');
  const [project, setProject] = useState('');
  const [pat, setPat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api().invoke('connections:save', { organizationUrl, project, pat });
      setConnections(await api().invoke('connections:list'));
      setPat('');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="conn-form">
      <label htmlFor="conn-url">Organization URL</label>
      <input
        id="conn-url"
        className="field mono"
        value={organizationUrl}
        onChange={(e) => setOrganizationUrl(e.target.value)}
        placeholder="https://dev.azure.com/your-org"
      />
      <label htmlFor="conn-project">Project</label>
      <input
        id="conn-project"
        className="field"
        value={project}
        onChange={(e) => setProject(e.target.value)}
      />
      <label htmlFor="conn-pat">Personal access token</label>
      <input
        id="conn-pat"
        className="field mono"
        type="password"
        autoComplete="off"
        value={pat}
        onChange={(e) => setPat(e.target.value)}
      />
      {error && (
        <div className="conn-status-bad" style={{ gridColumn: '1 / -1' }}>
          {error}
        </div>
      )}
      <div className="small muted" style={{ gridColumn: '1 / -1' }}>
        The token needs Work Items (read) and Code (read). It is encrypted with
        the OS keychain and never shown again.
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={
            busy || !organizationUrl.trim() || !project.trim() || !pat.trim()
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}

export function ConnectionsSection() {
  const connections = useStore((s) => s.connections);
  const [adding, setAdding] = useState(false);
  return (
    <section id="ado" className="section">
      <div className="section-head">
        <h2>Azure DevOps</h2>
        <button
          type="button"
          className="btn"
          onClick={() => setAdding(true)}
          disabled={adding}
        >
          Add connection&hellip;
        </button>
      </div>
      <div className="list">
        {connections.length === 0 && !adding && (
          <div className="empty">
            No connections yet. Add your organization and project with a
            personal access token.
          </div>
        )}
        {connections.map((c) => (
          <ConnectionRow key={c.id} connection={c} />
        ))}
        {adding && <AddConnectionForm onDone={() => setAdding(false)} />}
      </div>
    </section>
  );
}
