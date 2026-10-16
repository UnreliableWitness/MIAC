import { useId } from 'react';

// The app icon's tally (assets/icon/miac-small.svg at 1/8 scale): bars sit on the pixel grid at 16px.
const BARS = [
  [4, '#0063b1'],
  [20, '#0f6cbd'],
  [36, '#1a7fd0'],
  [52, '#2b88d8'],
] as const;
const SLASH = 'M5 48 L59 16';

export function MindMark({ size = 16 }: { size?: number }) {
  const id = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      className="mindmark"
    >
      <defs>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#50e6ff" />
          <stop offset="1" stopColor="#0078d4" />
        </linearGradient>
        <mask
          id={`${id}m`}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="64"
          height="64"
        >
          <rect width="64" height="64" fill="#fff" />
          <path
            d={SLASH}
            stroke="#000"
            strokeWidth="19"
            strokeLinecap="round"
          />
        </mask>
      </defs>
      <g mask={`url(#${id}m)`}>
        {BARS.map(([x, color]) => (
          <rect key={x} x={x} y="8" width="8" height="48" fill={color} />
        ))}
      </g>
      <path
        d={SLASH}
        fill="none"
        stroke={`url(#${id}s)`}
        strokeWidth="9"
        strokeLinecap="round"
      />
    </svg>
  );
}
