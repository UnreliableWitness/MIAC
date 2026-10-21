import {
  AGENT_TOOLS,
  formatDuration,
  TOOL_LABEL,
  type AgentTool,
} from '../../shared/time';
import { api, tryInvoke } from '../api';
import { useEstimateHours } from '../hooks/useEstimateHours';
import { useTaskTime } from '../hooks/useTaskTime';
import { useStore, useTaskConnectionId } from '../store';

const TOOL_COLOR: Record<AgentTool, string> = {
  'claude-code': 'var(--chart-claude)',
  'copilot-cli': 'var(--chart-copilot)',
  opencode: 'var(--chart-opencode)',
};
const pct = (n: number, of: number) =>
  `${of > 0 ? Math.min(100, (100 * n) / of) : 0}%`;

/**
 * The Time card on the Usage tab: one bar of the wall clock (work hours) split into you in Shellie, agents
 * working alone and the rest, agent time per tool on the same scale, the estimate and the booking.
 */
export function TimePanel({ taskId }: { taskId: string }) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId));
  const connectionId = useTaskConnectionId(task ?? null);
  const notify = useStore((s) => s.notify);
  const { time } = useTaskTime(taskId);
  const estimateHours = useEstimateHours(
    connectionId,
    task?.workItem?.id ?? null,
    time,
  );
  const exportCsv = async () => {
    const csv = await tryInvoke(
      () => api().invoke('time:exportCsv', taskId),
      notify,
    );
    if (csv === undefined || !task) return;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `shellie-time-${task.slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const agents = AGENT_TOOLS.filter((t) => (time?.agentSeconds[t] ?? 0) > 0);
  const shown = time?.booking?.bookedSeconds ?? time?.activeSeconds ?? 0;
  const estimateSeconds = estimateHours ? estimateHours * 3600 : 0;
  const estPct = estimateSeconds > 0 ? (shown / estimateSeconds) * 100 : 0;

  const you = time?.activeSeconds ?? 0;
  const both = Math.max(you, time?.realisticSeconds ?? 0);
  const wall = time?.wallClockSeconds ?? 0;
  const alone = both - you;
  const rest = Math.max(0, wall - both);
  // Work outside working hours can make you + agents longer than the wall clock; the bar then spans that.
  const scale = Math.max(wall, both);
  const parts = [
    {
      key: 'you',
      label: 'You in Shellie',
      seconds: you,
      color: 'var(--chart-you)',
    },
    {
      key: 'agents',
      label: 'Agents alone',
      seconds: alone,
      color: 'var(--chart-agents)',
    },
    {
      key: 'rest',
      label: 'Rest of the wall clock',
      seconds: rest,
      color: null,
    },
  ];

  return (
    <div className="card up-box up-time">
      <h3>Time</h3>
      {time && (
        <>
          <div className="time-summary">
            <span>
              <b className="mono time-big" data-testid="time-both">
                {formatDuration(both)}
              </b>{' '}
              <span className="muted">you + agents</span>
            </span>
            <span className="small muted" data-testid="time-wall">
              of <b className="mono">{formatDuration(wall)}</b> wall clock (work
              hours)
            </span>
          </div>
          <div
            className="time-stack"
            role="img"
            aria-label={`You in Shellie ${formatDuration(you)}, agents alone ${formatDuration(alone)}, wall clock ${formatDuration(wall)}`}
            data-testid="time-stack"
          >
            {parts
              .filter((p) => p.seconds > 0)
              .map((p) => (
                <i
                  key={p.key}
                  data-part={p.key}
                  data-seconds={p.seconds}
                  title={`${p.label}: ${formatDuration(p.seconds)}`}
                  style={{
                    width: pct(p.seconds, scale),
                    background: p.color ?? undefined,
                  }}
                />
              ))}
          </div>
          <ul className="time-legend" aria-label="Time legend">
            {parts.map((p) => (
              <li key={p.key} data-part={`legend-${p.key}`}>
                <i
                  className={p.color ? 'dot' : 'dot is-rest'}
                  style={p.color ? { background: p.color } : undefined}
                />
                {p.label} <b className="mono">{formatDuration(p.seconds)}</b>
              </li>
            ))}
          </ul>
          {agents.length > 0 && (
            <div className="time-agents" aria-label="Agent time">
              <span className="small muted time-agents-head">Agent time</span>
              {agents.map((t) => (
                <div key={t} className="time-agent" data-part={`agent-${t}`}>
                  <span className="small">{TOOL_LABEL[t]}</span>
                  <div className="time-track">
                    <i
                      style={{
                        width: pct(time.agentSeconds[t], scale),
                        background: TOOL_COLOR[t],
                      }}
                    />
                  </div>
                  <b className="mono small">
                    {formatDuration(time.agentSeconds[t])}
                  </b>
                </div>
              ))}
            </div>
          )}
          {time.booking && (
            <dl className="usage-fields">
              <div>
                <dt>booked</dt>
                <dd className="mono">
                  {formatDuration(time.booking.bookedSeconds)}
                </dd>
              </div>
            </dl>
          )}
        </>
      )}
      {time && estimateSeconds > 0 && (
        <div className="time-est">
          <span className="small">{`${formatDuration(shown)} of ${formatDuration(estimateSeconds)} estimate`}</span>
          <div
            className={estPct > 100 ? 'time-bar over' : 'time-bar'}
            data-testid="time-bar"
          >
            <i style={{ width: `${Math.min(100, estPct)}%` }} />
          </div>
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={exportCsv}>
          Export time (CSV)
        </button>
      </div>
    </div>
  );
}
