import { useId } from 'react';

// The app icon (assets/icon/miac-small.svg at 1/8 scale): four fused stripes struck through by a swoosh.
const STRIPES = ['#003a6c', '#005ba1', '#0f6cbd', '#2b88d8'];
const SWOOSH = 'M0 42.5 Q31.25 36.25 64 10 L64 16.5 Q33.75 48.75 0 59.4 Z';

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
        <clipPath id={`${id}b`}>
          <rect x="8" y="8" width="48" height="48" />
        </clipPath>
      </defs>
      {STRIPES.map((color, i) => (
        <rect
          key={color}
          x={8 + 12 * i}
          y="8"
          width="12"
          height="48"
          fill={color}
        />
      ))}
      <path clipPath={`url(#${id}b)`} d={SWOOSH} fill="#fff" />
    </svg>
  );
}
