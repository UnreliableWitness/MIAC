import { useEffect, useState } from 'react';
import type { AppSettings } from '../../shared/usage';
import type {
  MiacConfig,
  Repo,
  StartSettings,
  WorkItemTypeMeta,
} from '../../shared/types';
import { api, tryInvoke } from '../api';
import { ConnectionsSection } from '../components/ConnectionsSection';
import { CostSection } from '../components/CostSection';
import { MindMark, PageHeader } from '../components/ui';
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

function StartOptions({ repo }: { repo: Repo }) {
  const notify = useStore((s) => s.notify);
  const [types, setTypes] = useState<WorkItemTypeMeta[] | null>(null);
  const settings = repo.workItemOnStart;
  const connectionId = repo.connectionId;

  // repos:changed is broadcast by the handler and refreshes the store.
  const save = (next: StartSettings) =>
    tryInvoke(
      () => api().invoke('repos:setWorkItemOnStart', repo.id, next),
      notify,
    );

  const loadTypes = async (open: boolean) => {
    if (!open || types !== null || !connectionId) return;
    const result = await tryInvoke(
      () => api().invoke('workItems:types', connectionId),
      notify,
    );
    if (result) setTypes(result);
  };

  const choose = (type: string, state: string) => {
    const { [type]: _removed, ...rest } = settings.stateOverrides;
    void save({
      ...settings,
      stateOverrides: state ? { ...rest, [type]: state } : rest,
    });
  };

  return (
    <div className="list-row" style={{ display: 'block' }}>
      <div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.moveToInProgress}
            onChange={(e) =>
              void save({ ...settings, moveToInProgress: e.target.checked })
            }
          />{' '}
          Move the work item to In Progress on start
        </label>
      </div>
      <div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.assignToMe}
            onChange={(e) =>
              void save({ ...settings, assignToMe: e.target.checked })
            }
          />{' '}
          Assign it to me if unassigned
        </label>
      </div>
      <details
        onToggle={(e) =>
          void loadTypes((e.currentTarget as HTMLDetailsElement).open)
        }
      >
        <summary>Override per type</summary>
        {types?.map((t) => (
          <div key={t.name} className="small" style={{ marginTop: 4 }}>
            <span>{t.name}</span>{' '}
            <select
              className="field"
              aria-label={`In Progress state for ${t.name}`}
              value={settings.stateOverrides[t.name] ?? ''}
              onChange={(e) => choose(t.name, e.target.value)}
            >
              <option value="">Default</option>
              {t.states
                .filter((s) => s.category === 'InProgress')
                .map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
        ))}
      </details>
    </div>
  );
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
            // repos:changed is broadcast by the handler and updates the store.
            await tryInvoke(
              () => api().invoke('repos:setConnection', repo.id, value),
              notify,
            );
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
      {repo.connectionId && <StartOptions repo={repo} />}
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

function AppearanceSection() {
  const notify = useStore((s) => s.notify);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    let live = true;
    void tryInvoke(() => api().invoke('settings:get'), notify).then((s) => {
      if (live && s) setSettings(s);
    });
    return () => {
      live = false;
    };
  }, [notify]);

  const toggle = async (
    patch: Partial<Pick<AppSettings, 'showSplash' | 'sendTelemetry'>>,
  ) => {
    if (!settings) return;
    // Read fresh so a save from another section is not overwritten.
    const saved = await tryInvoke(async () => {
      const fresh = await api().invoke('settings:get');
      return api().invoke('settings:save', { ...fresh, ...patch });
    }, notify);
    if (saved) setSettings(saved);
  };

  return (
    <section id="appearance" className="section">
      <div className="section-head">
        <h2>Appearance</h2>
      </div>
      <div className="list">
        <div className="list-row">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings?.showSplash ?? true}
              disabled={!settings}
              onChange={(e) => void toggle({ showSplash: e.target.checked })}
            />{' '}
            Show splash on start
          </label>
        </div>
        <div className="list-row">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings?.sendTelemetry ?? true}
              disabled={!settings}
              onChange={(e) => void toggle({ sendTelemetry: e.target.checked })}
            />{' '}
            Send anonymous usage and error data
          </label>
        </div>
      </div>
    </section>
  );
}

function AboutSection() {
  const [version, setVersion] = useState('');

  useEffect(() => {
    let live = true;
    api()
      .invoke('app:info')
      .then((i) => {
        if (live) setVersion(i.version);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <section id="about" aria-label="About" className="section">
      <div className="section-head">
        <h2>About</h2>
      </div>
      <div className="card about">
        <MindMark size={40} />
        <div>
          <div className="about-name">MIAC</div>
          <div className="muted">Me, I&apos;m Counting</div>
          <div className="small muted">
            General Systems Vehicle (accounting division)
          </div>
          {version && <div className="mono small muted">v{version}</div>}
        </div>
      </div>
    </section>
  );
}

export function SettingsScreen() {
  const repos = useStore((s) => s.repos);
  const setRepos = useStore((s) => s.setRepos);
  const notify = useStore((s) => s.notify);

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
    <div className="page">
      <PageHeader title="Settings" />
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          <a href="#repos" className="active">
            Repositories
          </a>
          <a href="#ado">Azure DevOps</a>
          <a href="#cost">AI cost and invoicing</a>
          <a href="#appearance">Appearance</a>
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
          <CostSection />
          <section id="terminals" className="section">
            <div className="section-head">
              <h2>Terminals and Claude</h2>
            </div>
            <p className="placeholder">
              Default shell and Claude flags are fixed to the platform defaults
              for now.
            </p>
          </section>
          <AppearanceSection />
          <AboutSection />
        </main>
      </div>
    </div>
  );
}
