import type { SetupState } from '../../shared/types';

// Glyphs built from code points to keep the source pure ASCII.
const ICON = {
  todo: String.fromCharCode(0x25cb),
  running: String.fromCharCode(0x25cf),
  done: String.fromCharCode(0x2713),
  failed: String.fromCharCode(0x2715),
} as const;

export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '';
  return ms >= 10_000
    ? `${Math.round(ms / 1000)}s`
    : `${(ms / 1000).toFixed(1)}s`;
}

export function StepList({ steps }: { steps: SetupState['steps'] }) {
  return (
    <ol className="steps">
      {steps.map((s, i) => (
        <li
          key={i}
          className="step"
          data-status={s.status}
          aria-label={s.def.label}
        >
          <span className="step-icon" aria-hidden="true">
            {ICON[s.status]}
          </span>
          <span className="step-text">
            <span className="step-label">{s.def.label}</span>
            <span
              className="mono small muted"
              style={{ overflowWrap: 'anywhere' }}
            >
              {s.detail ?? s.def.detail}
            </span>
          </span>
          <span className="small muted">{formatMs(s.ms)}</span>
        </li>
      ))}
    </ol>
  );
}
