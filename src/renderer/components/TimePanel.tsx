import { AGENT_TOOLS, formatDuration, type AgentTool } from '../../shared/time';
import { api, tryInvoke } from '../api';
import { useEstimateHours } from '../hooks/useEstimateHours';
import { useTaskTime } from '../hooks/useTaskTime';
import { useStore, useTaskConnectionId } from '../store';

const TOOL_LABEL: Record<AgentTool, string> = {
  'claude-code': 'Claude Code',
  'copilot-cli': 'Copilot CLI',
  opencode: 'OpenCode est.',
};

/** The Time card on the Usage tab: measured time, agent time per tool, the estimate and the booking. */
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
  const pct = estimateSeconds > 0 ? (shown / estimateSeconds) * 100 : 0;

  return (
    <div className="card up-box up-time">
      <h3>Time</h3>
      {time && (
        <dl className="usage-fields">
          <div>
            <dt>measured</dt>
            <dd className="mono">{formatDuration(time.activeSeconds)}</dd>
          </div>
          <div>
            <dt>you + agents</dt>
            <dd className="mono">{formatDuration(time.realisticSeconds)}</dd>
          </div>
          <div>
            <dt>wall clock (work hrs)</dt>
            <dd className="mono">{formatDuration(time.wallClockSeconds)}</dd>
          </div>
          {time.booking && (
            <div>
              <dt>booked</dt>
              <dd className="mono">
                {formatDuration(time.booking.bookedSeconds)}
              </dd>
            </div>
          )}
        </dl>
      )}
      {agents.length > 0 && time && (
        <div className="small muted">
          Agent time:{' '}
          {agents.map((t) => (
            <span key={t}>
              <b className="mono">{formatDuration(time.agentSeconds[t])}</b>{' '}
              {TOOL_LABEL[t]}{' '}
            </span>
          ))}
        </div>
      )}
      {time && estimateSeconds > 0 && (
        <div className="time-est">
          <span className="small">{`${formatDuration(shown)} of ${formatDuration(estimateSeconds)} estimate`}</span>
          <div
            className={pct > 100 ? 'time-bar over' : 'time-bar'}
            data-testid="time-bar"
          >
            <i style={{ width: `${Math.min(100, pct)}%` }} />
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
