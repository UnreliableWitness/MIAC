import { ArrowClockwise16Regular } from '@fluentui/react-icons';
import { useEffect } from 'react';
import { Band } from '../components/home/Band';
import { PrBand } from '../components/home/PrBand';
import { SprintsBand } from '../components/home/SprintsBand';
import { TasksBand } from '../components/home/TasksBand';
import { PageHeader } from '../components/ui';
import { ago } from '../format';
import { useHome } from '../hooks/useHome';
import { chipState } from '../homeView';
import { useStore } from '../store';
import { useWorkItemTypes } from '../workItemTypes';

const CHIP_TEXT = {
  ok: 'connected',
  stale: 'stale',
  error: 'not connected',
} as const;

export function HomeScreen() {
  const { snapshot, refreshing, refresh } = useHome();
  const connections = useStore((s) => s.connections);
  const go = useStore((s) => s.go);
  const loadTypes = useWorkItemTypes((s) => s.load);
  useEffect(() => {
    for (const c of snapshot?.connections ?? []) loadTypes(c.connectionId);
  }, [snapshot, loadTypes]);
  const byId = new Map(snapshot?.connections.map((c) => [c.connectionId, c]));
  const refused = connections.filter((c) => c.status === 'unauthorized');
  return (
    <div className="page home">
      <PageHeader
        title="Home"
        after={
          snapshot && (
            <span className="muted small home-updated">
              {refreshing ? 'Updating' : `Updated ${ago(snapshot.builtAt)}`}
            </span>
          )
        }
        commands={
          <>
            <div className="home-chips">
              {connections.map((c) => {
                const h = byId.get(c.id);
                const state = chipState(h, c);
                const detail =
                  state === 'ok'
                    ? CHIP_TEXT.ok
                    : `${CHIP_TEXT[state]}${h?.error ? `: ${h.error}` : ''}`;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`home-chip is-${state}`}
                    aria-label={`${c.name}: ${c.project}, ${detail}`}
                    title={detail}
                    onClick={() => go({ kind: 'settings' })}
                  >
                    <span className="dot" />
                    {c.name}/{c.project}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="btn"
              aria-label="Refresh"
              disabled={refreshing}
              onClick={refresh}
            >
              <ArrowClockwise16Regular aria-hidden="true" />
            </button>
          </>
        }
      />
      {refused.map((c) => (
        <p key={c.id} className="home-warning" role="status">
          Azure DevOps refused the token for {c.name}/{c.project}. Update it in
          Settings.
        </p>
      ))}
      <div className="home-bands">
        <TasksBand snapshot={snapshot} />
        {connections.length === 0 ? (
          <button
            type="button"
            className="btn btn-primary home-connect"
            onClick={() => go({ kind: 'settings' })}
          >
            Add an Azure DevOps connection
          </button>
        ) : (
          <>
            {snapshot ? (
              <PrBand snapshot={snapshot} />
            ) : (
              <Band title="Reviews for me">
                <p className="muted">Loading</p>
              </Band>
            )}
            {snapshot ? (
              <SprintsBand snapshot={snapshot} />
            ) : (
              <Band title="My sprints">
                <p className="muted">Loading</p>
              </Band>
            )}
          </>
        )}
        <Band title="Stats">
          <p className="muted">No activity yet.</p>
        </Band>
      </div>
    </div>
  );
}
