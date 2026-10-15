export const REFERENCE_EUR = 50;
const R = 24;
const C = 2 * Math.PI * R;
const clamp = (n: number) =>
  Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
const round = (n: number) => Math.round(n * 1000) / 1000;

export function RingGauge({
  value,
  max,
  size = 18,
  segments,
  label,
}: {
  value: number;
  max?: number;
  size?: number;
  segments?: { value: number; color: string }[];
  label?: string;
}) {
  const scale = max ?? REFERENCE_EUR;
  const a11y = label
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': true as const };
  let offset = 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className="ring"
      {...a11y}
    >
      <circle
        cx="32"
        cy="32"
        r={R}
        fill="none"
        stroke="var(--line-strong)"
        strokeWidth="7"
      />
      {segments ? (
        segments.map((s, i) => {
          const f = round(clamp(s.value / scale));
          const el = (
            <circle
              key={i}
              data-part="segment"
              data-fraction={f}
              cx="32"
              cy="32"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="7"
              strokeDasharray={`${f * C} ${C}`}
              strokeDashoffset={-offset * C}
              transform="rotate(-90 32 32)"
            />
          );
          offset += f;
          return el;
        })
      ) : (
        <circle
          data-part="arc"
          data-fraction={round(clamp(value / scale))}
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="7"
          strokeDasharray={`${round(clamp(value / scale)) * C} ${C}`}
          transform="rotate(-90 32 32)"
        />
      )}
    </svg>
  );
}
