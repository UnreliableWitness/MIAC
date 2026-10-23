import { Shield16Filled, Warning16Regular } from '@fluentui/react-icons';
import { useCallback, useEffect, useState } from 'react';
import type {
  Environment,
  SecretScope,
  SecretView,
  SecretsReason,
  SecretsStatus,
} from '../../shared/secrets';
import { api, tryInvoke } from '../api';
import { SecretEditor } from '../components/secrets/SecretEditor';
import { GIVEN_LABEL, SecretRow } from '../components/secrets/SecretRow';
import { ConfirmBar, PageHeader } from '../components/ui';
import { ENVIRONMENTS, ENVIRONMENT_LABEL } from '../../shared/secrets';
import { useStore } from '../store';

type Editing =
  | { kind: 'new'; env?: Environment }
  | { kind: 'edit'; secret: SecretView; env?: Environment };

function reasonText(r: SecretsReason): string {
  const files = (r as { files?: string[] }).files;
  switch (r.kind) {
    case 'copy':
      return `It still copies ${files?.join(', ')} into every worktree (copy: in its .shellie.yml), where agents can read it.`;
    case 'tracked':
      return `${files?.join(', ')} ${files?.length === 1 ? 'is' : 'are'} committed to git with values in them.`;
    case 'worktrees':
      return `${r.taskIds.length} ${r.taskIds.length === 1 ? 'task' : 'tasks'} still ${r.taskIds.length === 1 ? 'has' : 'have'} a worktree with a .env file from before.`;
  }
}

function StatusPanel({
  repoName,
  repoId,
  status,
}: {
  repoName: string;
  repoId: string;
  status: SecretsStatus | null;
}) {
  const go = useStore((s) => s.go);
  if (!status || status.state === 'empty') return null;
  if (status.state === 'protected')
    return (
      <div className="secret-panel secret-panel-ok">
        <Shield16Filled aria-hidden="true" />
        <div>
          <strong>{repoName} is protected.</strong>{' '}
          {status.given.length > 0
            ? `Its secrets reach the ${status.given.map((g) => GIVEN_LABEL[g]).join(' and ')} tabs only. `
            : ''}
          Claude Code, Copilot and OpenCode tabs run without them.
        </div>
      </div>
    );
  return (
    <div className="secret-panel secret-panel-warn">
      <Warning16Regular aria-hidden="true" />
      <div>
        <strong>{repoName} still needs attention.</strong>
        <ul>
          {status.reasons.map((r, i) => (
            <li key={i}>{reasonText(r)}</li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => go({ kind: 'secrets-import', repoId })}
      >
        Move values into Shellie…
      </button>
    </div>
  );
}

/** Settings > Secrets: what Shellie keeps for each repository, where it came from and which tabs get it. */
export function SecretsScreen({ repoId }: { repoId?: string }) {
  const repos = useStore((s) => s.repos);
  const notify = useStore((s) => s.notify);
  const go = useStore((s) => s.go);
  const [scope, setScope] = useState<string>(repoId ?? 'all');
  const [shown, setShown] = useState<SecretView[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<SecretsStatus | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<SecretView | null>(null);

  const load = useCallback(async () => {
    const lists = await tryInvoke(
      () =>
        Promise.all([
          api().invoke('secrets:list', scope),
          api().invoke('secrets:list', 'all'),
          ...repos.map((r) => api().invoke('secrets:list', r.id)),
        ]),
      notify,
    );
    if (!lists) return;
    const [current, all, ...perRepo] = lists;
    setShown(current);
    const next: Record<string, number> = { all: all.length };
    repos.forEach((r, i) => {
      next[r.id] = (perRepo[i] ?? []).filter(
        (x) => typeof x.scope !== 'string' && x.scope.repoId === r.id,
      ).length;
    });
    setCounts(next);
    if (scope !== 'all') {
      const st = await tryInvoke(
        () => api().invoke('secrets:status', scope),
        notify,
      );
      if (st) setStatus(st);
    } else setStatus(null);
  }, [scope, repos, notify]);

  useEffect(() => {
    void load();
    return api().on('secrets:changed', () => void load());
  }, [load]);

  const repo = repos.find((r) => r.id === scope);
  const newScope: SecretScope = scope === 'all' ? 'all' : { repoId: scope };

  const move = async (secret: SecretView) => {
    const saved = await tryInvoke(
      () =>
        api().invoke('secrets:save', {
          id: secret.id,
          scope: 'all',
          name: secret.name,
          givenTo: secret.givenTo,
          values: {},
        }),
      notify,
    );
    if (saved) await load();
  };

  const remove = async () => {
    if (!deleting) return;
    const id = deleting.id;
    setDeleting(null);
    await tryInvoke(() => api().invoke('secrets:delete', id), notify);
    await load();
  };

  return (
    <div className="page">
      <PageHeader
        title="Secrets"
        commands={
          <>
            <button
              type="button"
              className="btn"
              disabled={!repo}
              title={repo ? undefined : 'Pick a repository first'}
              onClick={() =>
                repo && go({ kind: 'secrets-import', repoId: repo.id })
              }
            >
              Import from .env…
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setEditing({ kind: 'new' })}
            >
              + Add secret
            </button>
          </>
        }
      />
      <p className="secrets-lede">
        Shellie keeps these encrypted on this machine and hands them only to the
        tabs that need them. Agent tabs never get them, and no worktree gets a
        .env file.
      </p>
      <div className="secrets">
        <nav className="secrets-scope" aria-label="Scope">
          <h2>Scope</h2>
          {[
            { id: 'all', name: 'All repositories' },
            ...repos.map((r) => ({ id: r.id, name: r.name })),
          ].map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={scope === s.id ? 'true' : undefined}
              onClick={() => {
                setScope(s.id);
                setShown(null);
                setStatus(null);
                setEditing(null);
              }}
            >
              <span>{s.name}</span>
              <span>{counts[s.id] ?? 0}</span>
            </button>
          ))}
        </nav>
        <div className="secrets-main">
          {repo && (
            <StatusPanel
              repoName={repo.name}
              repoId={repo.id}
              status={status}
            />
          )}
          {editing && (
            <SecretEditor
              key={editing.kind === 'edit' ? editing.secret.id : 'new'}
              repos={repos}
              scope={newScope}
              initial={editing.kind === 'edit' ? editing.secret : undefined}
              focusEnv={editing.env}
              onDone={() => {
                setEditing(null);
                void load();
              }}
              onCancel={() => setEditing(null)}
            />
          )}
          {deleting && (
            <ConfirmBar
              message={`Delete ${deleting.name}? Its values are removed from this machine.`}
              confirmLabel="Delete secret"
              onConfirm={() => void remove()}
              onCancel={() => setDeleting(null)}
            />
          )}
          {shown && shown.length === 0 && !editing && (
            <p className="secrets-empty">
              No secrets here yet. Add one, or import the values from a .env
              file.
            </p>
          )}
          {shown && shown.length > 0 && (
            <table className="secrets-table">
              <thead>
                <tr>
                  <th>Name</th>
                  {ENVIRONMENTS.map((e) => (
                    <th key={e}>{ENVIRONMENT_LABEL[e]}</th>
                  ))}
                  <th>Given to</th>
                  <th>Changed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <SecretRow
                    key={s.id}
                    secret={s}
                    allRepos={s.scope === 'all' && scope !== 'all'}
                    onAdd={(env) =>
                      setEditing({ kind: 'edit', secret: s, env })
                    }
                    onEdit={() => setEditing({ kind: 'edit', secret: s })}
                    onMove={() => void move(s)}
                    onDelete={() => setDeleting(s)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
