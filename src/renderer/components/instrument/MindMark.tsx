import { useId } from 'react';

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
        <radialGradient id={`${id}g`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffd08a" />
          <stop offset="0.4" stopColor="#f0a443" stopOpacity="0.7" />
          <stop offset="1" stopColor="#f0a443" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle
        cx="32"
        cy="32"
        r="26"
        fill="none"
        stroke="#2c3142"
        strokeWidth="3"
      />
      <path
        d="M32 6 A26 26 0 0 1 58 32"
        fill="none"
        stroke="#f0a443"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="32" cy="32" r="16" fill={`url(#${id}g)`} />
      <circle cx="32" cy="32" r="8" fill="#f6e7c8" />
    </svg>
  );
}
