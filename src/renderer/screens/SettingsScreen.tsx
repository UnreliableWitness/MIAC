import { useState } from 'react';
import type { MiacConfig, Repo } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { ConnectionsSection } from '../components/ConnectionsSection';
import { TopBar } from '../components/TopBar';
import { useStore } from '../store';

function renderConfig(
  name: string,
  c: MiacConfig,
  worktreeRoot: string,
): string {
  const lines = [
    `${name}/.miac.yml${c.found ? '' : ' (defaults, file not found)'}`,
    `base: ${c.base}`,
    `branch: "${c.branch}"`,
    `copy: [${c.copy.join(', ')}]`,
    'setup:',
    ...c.setup.map((s) => `  - ${s}`),
    'run:',
    ...Object.entries(c.run).map(([k, v]) => `  ${k}: ${v}`),
    '',
    `# worktrees go in ${worktreeRoot}`,
  ];
  return lines.join('\n');
}

function RepoRow({ repo }: { repo: Repo }) {
  const notify = useStore((s) => s.notify);
  const setRepos = useStore((s) => s.setRepos);
  const connections = useStore((s) => s.connections);
  const [shown, setShown] = useState<string | null>(null);

  const show = async () => {
    if (shown !== null) return setShown(null);
    const result = await tryInvoke(
      () => api().invoke('repos:config', repo.id),
      notify,
    );
    if (result)
      setShown(renderConfig(repo.name, result.config, result.worktreeRoot));
  };
  const remove = async () => {
    const ok = await tryInvoke(async () => {
      await api().invoke('repos:remove', repo.id);
      return true;
    }, notify);
    if (ok) setRepos(await api().invoke('repos:list'));
  };

  return (
    <>
      <div className="list-row">
        <div className="grow">
          <span style={{ fontWeight: 600 }}>{repo.name}</span>
          <span className="mono small muted">
            {repo.path} &middot; base {repo.baseBranch}
          </span>
        </div>
        {repo.miacYmlFound ? (
          <span className="tag tag-green">.miac.yml found</span>
        ) : (
          <span className="tag tag-warn">No .miac.yml, using defaults</span>
        )}
        <select
          className="field"
          aria-label={`Connection for ${repo.name}`}
          value={repo.connectionId ?? ''}
          onChange={async (e) => {
            const value = e.target.value || null;
            const ok = await tryInvoke(
              () => api().invoke('repos:setConnection', repo.id, value),
              notify,
            );
            if (ok) setRepos(await api().invoke('repos:list'));
          }}
        >
          <option value="">No connection</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} / {c.project}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-ghost btn-sm" onClick={show}>
          {shown === null ? 'Show setup' : 'Hide setup'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={remove}>
          Remove
        </button>
      </div>
      {shown !== null && (
        <div
          className="codeblock"
          style={{ borderRadius: 0, borderWidth: '0 0 1px 0' }}
        >
          {shown}
        </div>
      )}
    </>
  );
}

export function SettingsScreen() {
  const repos = useStore((s) => s.repos);
  const setRepos = useStore((s) => s.setRepos);
  const notify = useStore((s) => s.notify);
  const go = useStore((s) => s.go);

  const addFolder = async () => {
    const folder = await tryInvoke(
      () => api().invoke('repos:pickFolder'),
      notify,
    );
    if (!folder) return;
    const added = await tryInvoke(
      () => api().invoke('repos:add', folder),
      notify,
    );
    if (added) setRepos(await api().invoke('repos:list'));
  };

  return (
    <>
      <TopBar crumb="Settings">
        <a
          href="#"
          className="spacer"
          onClick={(e) => {
            e.preventDefault();
            go({ kind: 'workspace' });
          }}
        >
          Back to tasks
        </a>
      </TopBar>
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          <a href="#repos" className="active">
            Repositories
          </a>
          <a href="#ado">Azure DevOps</a>
          <a href="#cost" className="disabled" aria-disabled="true">
            AI cost and invoicing
          </a>
          <a href="#terminals" className="disabled" aria-disabled="true">
            Terminals and Claude
          </a>
        </nav>
        <main className="settings-main">
          <section id="repos" className="section">
            <div className="section-head">
              <h2>Repositories</h2>
              <button type="button" className="btn" onClick={addFolder}>
                Add folder&hellip;
              </button>
            </div>
            {repos.length === 0 ? (
              <div className="list">
                <div className="empty">
                  No repositories yet. Add the folder of a git repository to
                  start tasks in it.
                </div>
              </div>
            ) : (
              <div className="list">
                {repos.map((r) => (
                  <RepoRow key={r.id} repo={r} />
                ))}
              </div>
            )}
          </section>
          <ConnectionsSection />
          <section id="cost" className="section">
            <div className="section-head">
              <h2>AI cost and invoicing</h2>
            </div>
            <p className="placeholder">
              Rate table, currency and customer mapping arrive with usage
              tracking.
            </p>
          </section>
          <section id="terminals" className="section">
            <div className="section-head">
              <h2>Terminals and Claude</h2>
            </div>
            <p className="placeholder">
              Default shell and Claude flags are fixed to the platform defaults
              for now.
            </p>
          </section>
        </main>
      </div>
    </>
  );
}
