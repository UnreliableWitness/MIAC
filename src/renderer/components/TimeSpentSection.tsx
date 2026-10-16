import { useState } from 'react';
import { formatDuration, parseDuration } from '../../shared/time';
import type { AgentTool, TaskTime } from '../../shared/time';
import type { TaskView } from '../../shared/types';
import { dateTime } from '../format';

const STEP = 300;
/** Marks closer than this (percent of the track) share one label; marks this close to an end align to it. */
const CLOSE = 12;
const EDGE = 12;

/** Slider values land on clock multiples of 5 minutes; the ends of the range stay exact. */
function snap(v: number, min: number, max: number): number {
  if (v <= min) return min;
  if (v >= max) return max;
  return Math.min(max, Math.max(min, Math.round(v / STEP) * STEP));
}
const TOOL_LABEL: Record<AgentTool, string> = {
  'claude-code': 'Claude Code',
  'copilot-cli': 'Copilot CLI',
  opencode: 'OpenCode est.',
};
const AGENT_ORDER: AgentTool[] = ['claude-code', 'copilot-cli', 'opencode'];

/** The Finish step "Time spent": one slider from measured to wall clock time, plus a field to type the booking. */
export function TimeSpentSection({
  task,
  time,
  estimateHours,
  value,
  onChange,
}: {
  task: TaskView;
  time: TaskTime;
  estimateHours: number | null;
  value: number | null;
  onChange: (seconds: number | null) => void;
}) {
  const [text, setText] = useState(() =>
    value === null ? '' : formatDuration(value),
  );
  const marks = [
    { key: 'measured', seconds: time.activeSeconds, label: 'measured' },
    { key: 'real', seconds: time.realisticSeconds, label: 'you + agents' },
    {
      key: 'wall',
      seconds: time.wallClockSeconds,
      label: 'wall clock (work hrs)',
    },
  ];
  const all = marks.map((m) => m.seconds);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = Math.max(1, max - min);
  const parsed = parseDuration(text);
  const hasEstimate = estimateHours !== null && estimateHours > 0;
  const invalid = parsed === null;
  const pct0 = (seconds: number) =>
    Math.min(100, Math.max(0, ((seconds - min) / span) * 100));
  const groups: {
    key: string;
    seconds: number;
    pct: number;
    labels: string[];
  }[] = [];
  for (const m of [...marks].sort((x, y) => x.seconds - y.seconds)) {
    const last = groups[groups.length - 1];
    if (last && pct0(m.seconds) - last.pct < CLOSE) {
      last.key += `+${m.key}`;
      last.labels.push(m.label);
    } else {
      groups.push({
        key: m.key,
        seconds: m.seconds,
        pct: pct0(m.seconds),
        labels: [m.label],
      });
    }
  }
  const shown = parsed ?? min;
  const agents = AGENT_ORDER.filter((t) => time.agentSeconds[t] > 0);
  const estimateSeconds = hasEstimate ? estimateHours * 3600 : 0;
  const pct =
    estimateSeconds > 0 && parsed !== null
      ? (parsed / estimateSeconds) * 100
      : 0;

  return (
    <div className="finish-section time-spent">
      <h2>Time spent</h2>
      <div className="muted small">{`Started ${dateTime(task.createdAt)} · finishing now`}</div>
      <div className="time-slider">
        <input
          type="range"
          aria-label="Time to book slider"
          min={min}
          max={Math.max(max, min + 1)}
          step={1}
          value={Math.min(Math.max(shown, min), Math.max(max, min + 1))}
          aria-valuetext={formatDuration(shown)}
          onChange={(e) => {
            const seconds = snap(Number(e.target.value), min, max);
            setText(formatDuration(seconds));
            onChange(seconds);
          }}
        />
        <div className="time-marks">
          {groups.map((g) => (
            <span
              key={g.key}
              className={`time-mark${g.pct <= EDGE ? ' edge-start' : ''}${g.pct >= 100 - EDGE ? ' edge-end' : ''}`}
              style={{ left: `${g.pct}%` }}
              data-key={g.key}
            >
              <b>{formatDuration(g.seconds)}</b>
              <span>{g.labels.join(' · ')}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="time-book">
        <label htmlFor="time-to-book">Time to book</label>
        <input
          id="time-to-book"
          type="text"
          value={text}
          aria-invalid={invalid}
          aria-describedby={invalid ? 'time-to-book-error' : undefined}
          onChange={(e) => {
            setText(e.target.value);
            onChange(parseDuration(e.target.value));
          }}
        />
      </div>
      {invalid && (
        <div id="time-to-book-error" className="text-warn small" role="alert">
          Enter a time like 3h 30m or 3.5
        </div>
      )}
      {hasEstimate && parsed !== null && (
        <div className="time-est">
          <span className="small">{`${formatDuration(parsed)} of ${formatDuration(estimateSeconds)} estimate`}</span>
          <div
            className={pct > 100 ? 'time-bar over' : 'time-bar'}
            data-testid="time-bar"
          >
            <i style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        </div>
      )}
      {agents.length > 0 && (
        <div className="time-agents small muted">
          Agent time:{' '}
          {agents.map((t) => (
            <span key={t}>
              <b>{formatDuration(time.agentSeconds[t])}</b> {TOOL_LABEL[t]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
