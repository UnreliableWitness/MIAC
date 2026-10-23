import { useState } from 'react';
import type { HomePeriod } from '../../../shared/home';
import { eur, formatDuration } from '../../format';
import { useHomeStats } from '../../hooks/useHomeStats';
import { useStore } from '../../store';
import { track } from '../../telemetry';
import { Band } from './Band';

function Tile({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="home-tile" title={title}>
      <span className="muted small">{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function StatsBand() {
  const [period, setPeriod] = useState<HomePeriod>('week');
  const stats = useHomeStats(period);
  const connections = useStore((s) => s.connections);
  const nameOf = (id: string | null) => {
    const c = connections.find((x) => x.id === id);
    return c ? `${c.name}/${c.project}` : 'No connection';
  };
  const choose = (p: HomePeriod) => {
    track('home.clicked', { band: 'stats-period' });
    setPeriod(p);
  };
  return (
    <Band title="Stats">
      <div className="home-period" role="group" aria-label="Period">
        <button
          type="button"
          aria-pressed={period === 'week'}
          onClick={() => choose('week')}
        >
          This week
        </button>
        <button
          type="button"
          aria-pressed={period === 'month'}
          onClick={() => choose('month')}
        >
          This month
        </button>
      </div>
      {stats && (
        <div className="home-tiles">
          <Tile
            label="AI cost"
            value={eur(stats.costEur)}
            title={[
              `Claude Code ${eur(stats.costByTool['claude-code'])}`,
              `Copilot CLI ${eur(stats.costByTool['copilot-cli'])}`,
              ...(stats.costByTool.opencode > 0
                ? [`OpenCode ${eur(stats.costByTool.opencode)}`]
                : []),
              ...stats.costByConnection.map(
                (c) => `${nameOf(c.connectionId)} ${eur(c.costEur)}`,
              ),
            ].join('\n')}
          />
          <Tile
            label="Active time"
            value={formatDuration(stats.activeSeconds)}
          />
          <Tile label="Agent time" value={formatDuration(stats.agentSeconds)} />
          <Tile
            label="Estimate accuracy"
            value={
              stats.accuracy === null
                ? '–'
                : `${Math.round(stats.accuracy * 100)}%`
            }
            title={
              stats.accuracyTasks
                ? `Booked over estimate, ${stats.accuracyTasks} finished tasks`
                : 'No finished task with an estimate'
            }
          />
          <Tile label="Tasks finished" value={String(stats.tasksFinished)} />
          <Tile label="PRs opened" value={String(stats.prsOpened)} />
        </div>
      )}
    </Band>
  );
}
