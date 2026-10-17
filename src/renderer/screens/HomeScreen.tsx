import { ArrowClockwise16Regular } from '@fluentui/react-icons';
import { Band } from '../components/home/Band';
import { PageHeader } from '../components/ui';
import { ago } from '../format';
import { useHome } from '../hooks/useHome';
import { chipState } from '../homeView';
import { useStore } from '../store';

const CHIP_TEXT = { ok: 'connected', stale: 'stale', error: 'not connected' } as const;

export function HomeScreen() {
  const { snapshot, refreshing, refresh } = useHome();
  const connections = useStore((s) => s.connections);
  const go = useStore((s) => s.go);
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
                const detail = state === 'ok' ? CHIP_TEXT.ok : `${CHIP_TEXT[state]}${h?.error ? `: ${h.error}` : ''}`;
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
          Azure DevOps refused the token for {c.name}/{c.project}. Update it in Settings.
        </p>
      ))}
      <div className="home-bands">
        <Band title="My tasks">
          <p className="muted">No open tasks.</p>
        </Band>
        {connections.length === 0 ? (
          <button type="button" className="btn btn-primary home-connect" onClick={() => go({ kind: 'settings' })}>
            Add an Azure DevOps connection
          </button>
        ) : (
          <>
            <div className="home-split">
              <Band title="Reviews for me">
                <p className="muted">No reviews waiting.</p>
              </Band>
              <Band title="My pull requests">
                <p className="muted">No open pull requests.</p>
              </Band>
            </div>
            <Band title="My sprints">
              <p className="muted">Nothing assigned to you in a current sprint.</p>
            </Band>
          </>
        )}
        <Band title="Stats">
          <p className="muted">No activity yet.</p>
        </Band>
      </div>
    </div>
  );
}
