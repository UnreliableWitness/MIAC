import { useEffect, useMemo, useRef, useState } from 'react';
import { renderBranch, taskSlug } from '../../shared/naming';
import type { MiacConfig, WorkItemRef, WorkItemType } from '../../shared/types';
import { api, tryInvoke } from '../api';
import { WorkItemPicker } from '../components/WorkItemPicker';
import { useStore } from '../store';

type Mode = 'pick' | 'typed' | 'blank';
const TYPES: WorkItemType[] = ['Issue', 'User Story', 'Bug', 'Task', 'Epic'];

export function NewTaskScreen() {
  const repos = useStore((s) => s.repos);
  const go = useStore((s) => s.go);
  const select = useStore((s) => s.select);
  const notify = useStore((s) => s.notify);
  const connections = useStore((s) => s.connections);

  const [repoId, setRepoId] = useState(repos[0]?.id ?? '');
  const connectionOf = (rid: string) => {
    const cid = repos.find((x) => x.id === rid)?.connectionId;
    return cid ? (connections.find((c) => c.id === cid) ?? null) : null;
  };
  const [rawMode, setMode] = useState<Mode>(() =>
    connectionOf(repoId) ? 'pick' : 'typed',
  );
  const modeChosen = useRef(false);
  const lastRepo = useRef(repoId);
  const [picked, setPicked] = useState<WorkItemRef | null>(null);
  const [config, setConfig] = useState<{
    config: MiacConfig;
    worktreeRoot: string;
  } | null>(null);
  const [id, setId] = useState('');
  const [type, setType] = useState<WorkItemType>('User Story');
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [branch, setBranch] = useState('');
  const [branchEdited, setBranchEdited] = useState(false);
  const [copy, setCopy] = useState(true);
  const [commands, setCommands] = useState<Record<string, boolean>>({});
  const [startClaude, setStartClaude] = useState(true);
  const [openShell, setOpenShell] = useState(true);
  const [busy, setBusy] = useState(false);

  const repo = repos.find((r) => r.id === repoId) ?? null;
  const connection = connectionOf(repoId);
  const connectionId = connection?.id ?? null;
  const mode: Mode = rawMode === 'pick' && !connection ? 'typed' : rawMode;

  useEffect(() => {
    const repoChanged = lastRepo.current !== repoId;
    lastRepo.current = repoId;
    if (repoChanged) {
      modeChosen.current = false;
      setPicked(null);
    }
    setMode((m) =>
      connectionId
        ? repoChanged || !modeChosen.current
          ? 'pick'
          : m
        : m === 'pick'
          ? 'typed'
          : m,
    );
  }, [repoId, connectionId]);

  useEffect(() => {
    if (!repoId) return;
    let live = true;
    setConfig(null);
    setBaseRef('');
    setCopy(true);
    setCommands({});
    setBranchEdited(false);
    void tryInvoke(() => api().invoke('repos:config', repoId), notify).then(
      (result) => {
        if (!live || !result) return;
        setConfig(result);
        setBaseRef(`origin/${result.config.base}`);
        setCommands(
          Object.fromEntries(result.config.setup.map((c) => [c, true])),
        );
      },
    );
    return () => {
      live = false;
    };
  }, [repoId, notify]);

  const changeMode = (next: Mode) => {
    modeChosen.current = true;
    setMode(next);
    setBranchEdited(false);
  };

  const workItem: WorkItemRef | null = useMemo(
    () =>
      mode === 'pick'
        ? picked
        : mode === 'typed' && (id.trim() || title.trim())
          ? { id: id.trim(), type, title: title.trim(), url: null }
          : null,
    [mode, picked, id, type, title],
  );
  const label =
    mode === 'blank'
      ? name
      : (workItem?.title ?? (mode === 'typed' ? title : ''));
  const template = config?.config.branch ?? '{type}/{id}-{slug}';

  useEffect(() => {
    if (branchEdited) return;
    setBranch(
      label.trim() || workItem?.id
        ? renderBranch(template, { workItem, name })
        : '',
    );
  }, [workItem, name, label, template, branchEdited]);

  const slug =
    label.trim() || workItem?.id
      ? taskSlug(workItem && workItem.id ? workItem : null, label)
      : '...';
  const folder = config ? `${config.worktreeRoot}/${slug}` : '';
  const baseOptions = config
    ? [`origin/${config.config.base}`, config.config.base]
    : [];

  const canCreate =
    mode === 'pick'
      ? picked !== null
      : mode === 'typed'
        ? Boolean(id.trim() && title.trim())
        : Boolean(name.trim());

  const create = async () => {
    if (busy) return;
    if (!repo) return notify('error', 'Add a repository in Settings first');
    setBusy(true);
    const task = await tryInvoke(
      () =>
        api().invoke('tasks:create', {
          repoId: repo.id,
          baseRef,
          name: mode === 'blank' ? name : '',
          workItem:
            mode === 'blank' ? null : workItem && workItem.id ? workItem : null,
          branch,
          copy,
          commands: (config?.config.setup ?? []).filter((c) => commands[c]),
          startClaude,
          openShell,
        }),
      notify,
    );
    setBusy(false);
    if (task) {
      select(task.id);
      go({ kind: 'setup', taskId: task.id });
    }
  };

  return (
    <div className="overlay">
      <div role="dialog" aria-labelledby="nt-title" className="dialog newtask">
        <div className="dialog-head">
          <h2 id="nt-title">New task</h2>
          <div role="tablist" aria-label="Start from" className="segmented">
            {connection && (
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'pick'}
                onClick={() => changeMode('pick')}
              >
                Work item
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'typed'}
              onClick={() => changeMode('typed')}
            >
              Typed
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'blank'}
              onClick={() => changeMode('blank')}
            >
              Blank task
            </button>
          </div>
          <button
            type="button"
            className="btn btn-ghost spacer"
            aria-label="Close"
            onClick={() => go({ kind: 'workspace' })}
          >
            &times;
          </button>
        </div>
        <div className="newtask-body">
          <section
            className="newtask-left"
            aria-label={mode === 'blank' ? 'Task' : 'Work item'}
          >
            {mode === 'pick' && connection ? (
              <WorkItemPicker
                connectionId={connection.id}
                selectedId={picked?.id ?? null}
                onPick={setPicked}
              />
            ) : mode === 'typed' ? (
              <div className="form-stack">
                <label>
                  Work item id
                  <input
                    className="field mono"
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                  />
                </label>
                <label>
                  Type
                  <select
                    className="field"
                    value={type}
                    onChange={(e) => setType(e.target.value as WorkItemType)}
                  >
                    {TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Title
                  <input
                    className="field"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
              </div>
            ) : (
              <div className="form-stack">
                <label>
                  Task name
                  <input
                    className="field"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              </div>
            )}
          </section>
          <section className="newtask-right" aria-label="Task preview">
            <div>
              <div className="muted small">
                {workItem?.id
                  ? `${workItem.type} ${workItem.id}`
                  : 'Blank task'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>
                {label || 'New task'}
              </div>
            </div>
            <div className="form-grid">
              <label htmlFor="nt-repo">Repo</label>
              <select
                id="nt-repo"
                className="field"
                value={repoId}
                onChange={(e) => setRepoId(e.target.value)}
              >
                {repos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <label htmlFor="nt-base">From</label>
              <select
                id="nt-base"
                className="field mono"
                value={baseRef}
                onChange={(e) => setBaseRef(e.target.value)}
              >
                {baseOptions.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
              <label htmlFor="nt-branch">Branch</label>
              <input
                id="nt-branch"
                className="field mono"
                value={branch}
                onChange={(e) => {
                  setBranchEdited(true);
                  setBranch(e.target.value);
                }}
                onBlur={(e) => {
                  if (!e.target.value) setBranchEdited(false);
                }}
              />
              <span className="label">Folder</span>
              <span className="mono small" style={{ overflowWrap: 'anywhere' }}>
                {folder}
              </span>
            </div>
            <fieldset className="group">
              <legend>Setup from .miac.yml</legend>
              {config && config.config.copy.length > 0 && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={copy}
                    onChange={(e) => setCopy(e.target.checked)}
                  />
                  Copy{' '}
                  <span className="mono small">
                    {config.config.copy.join(', ')}
                  </span>
                </label>
              )}
              {(config?.config.setup ?? []).map((c) => (
                <label key={c} className="checkbox">
                  <input
                    type="checkbox"
                    checked={commands[c] ?? false}
                    onChange={(e) => {
                      const { checked } = e.target;
                      setCommands((prev) => ({ ...prev, [c]: checked }));
                    }}
                  />
                  <span className="mono">{c}</span>
                </label>
              ))}
              {config &&
                config.config.setup.length === 0 &&
                config.config.copy.length === 0 && (
                  <span className="muted small">
                    Nothing to run for this repo.
                  </span>
                )}
            </fieldset>
            <fieldset className="group">
              <legend>When ready</legend>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={startClaude}
                  onChange={(e) => setStartClaude(e.target.checked)}
                />
                Start Claude Code with the task
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={openShell}
                  onChange={(e) => setOpenShell(e.target.checked)}
                />
                Open a shell tab
              </label>
            </fieldset>
            <div className="actions">
              <button
                type="button"
                className="btn"
                onClick={() => go({ kind: 'workspace' })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  busy || !repo || !config || !baseRef || !branch || !canCreate
                }
                onClick={create}
              >
                Create task
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
