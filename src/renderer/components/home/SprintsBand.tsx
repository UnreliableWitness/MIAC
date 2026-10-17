import { useEffect, useState } from 'react';
import type {
  HomeConnection,
  HomeSnapshot,
  HomeSprint,
} from '../../../shared/home';
import { formatDuration, type LocalItemTime } from '../../../shared/time';
import { api } from '../../api';
import { sprintTotals } from '../../homeView';
import { useStore } from '../../store';
import { track } from '../../telemetry';
import { stateMeta, useWorkItemTypes } from '../../workItemTypes';
import { TimeBar } from '../ui';
import { Band } from './Band';

const daysLeft = (finish: string | null): string | null => {
  if (!finish) return null;
  const days = Math.ceil((Date.parse(finish) - Date.now()) / 86_400_000);
  return days <= 0
    ? 'Ends today'
    : days === 1
      ? '1 day left'
      : `${days} days left`;
};

function SprintCard({
  connection,
  sprint,
  local,
}: {
  connection: HomeConnection;
  sprint: HomeSprint;
  local: Record<string, LocalItemTime>;
}) {
  const setConnectionId = useStore((s) => s.setConnectionId);
  const go = useStore((s) => s.go);
  const types = useWorkItemTypes(
    (s) => s.byConnection[connection.connectionId],
  );
  const t = sprintTotals(sprint, local, (type, state) =>
    types?.status === 'ok'
      ? stateMeta(types.types.get(type.toLowerCase()), state)?.category
      : undefined,
  );
  const over =
    t.estimateHours !== null &&
    t.estimateHours > 0 &&
    t.spentSeconds > t.estimateHours * 3600;
  const pct = t.estimateHours
    ? Math.round((t.spentSeconds / (t.estimateHours * 3600)) * 100)
    : null;
  const left = daysLeft(sprint.finishDate);
  return (
    <button
      type="button"
      className={
        connection.status === 'ok' ? 'home-card' : 'home-card is-stale-data'
      }
      aria-label={`${connection.name}/${connection.project}, ${sprint.name}`}
      onClick={() => {
        track('home.clicked', { band: 'sprint' });
        setConnectionId(connection.connectionId);
        go({ kind: 'sprint' });
      }}
    >
      <span className="home-card-title">
        {connection.name}/{connection.project} · {sprint.name}
      </span>
      <span className="muted small">
        {left && `${left} · `}
        {t.todo} to do · {t.doing} in progress · {t.done} done
      </span>
      <span className="small">
        {formatDuration(t.spentSeconds)}
        {t.estimateHours !== null &&
          ` / ${formatDuration(t.estimateHours * 3600)}`}
      </span>
      {pct !== null && <TimeBar pct={pct} over={over} />}
    </button>
  );
}

export function SprintsBand({ snapshot }: { snapshot: HomeSnapshot | null }) {
  const repos = useStore((s) => s.repos);
  const connections = snapshot?.connections ?? [];
  const [local, setLocal] = useState<
    Record<string, Record<string, LocalItemTime>>
  >({});
  const ids = connections
    .filter((c) => c.sprints.length > 0)
    .map((c) => c.connectionId)
    .join(',');
  useEffect(() => {
    let live = true;
    for (const id of ids ? ids.split(',') : [])
      api()
        .invoke('time:sprint', id)
        .then((t) => live && setLocal((l) => ({ ...l, [id]: t })))
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ids]);
  const linked = new Set(
    repos.filter((r) => !r.discovered).map((r) => r.connectionId),
  );
  const cards = connections.flatMap((c) =>
    c.sprints.map((s) => (
      <SprintCard
        key={`${c.connectionId}:${s.iterationId}`}
        connection={c}
        sprint={s}
        local={local[c.connectionId] ?? {}}
      />
    )),
  );
  const empty = connections.filter(
    (c) =>
      c.status === 'ok' &&
      c.sprints.length === 0 &&
      !c.sprintsError &&
      linked.has(c.connectionId),
  );
  return (
    <Band title="My sprints">
      <div className="home-cards">
        {cards}
        {empty.map((c) => (
          <div key={c.connectionId} className="home-card is-slim muted">
            {c.name}/{c.project}: nothing assigned
          </div>
        ))}
      </div>
      {cards.length === 0 && empty.length === 0 && (
        <p className="muted">Nothing assigned to you in a current sprint.</p>
      )}
      {connections
        .filter((c) => c.sprintsError)
        .map((c) => (
          <p key={c.connectionId} className="muted small">
            Couldn't load sprints for {c.name}/{c.project}
          </p>
        ))}
    </Band>
  );
}
