import type { ReactNode } from 'react';

export const modKey: 'Cmd' | 'Ctrl' =
  typeof navigator !== 'undefined' &&
  /Mac/.test(navigator.platform || navigator.userAgent)
    ? 'Cmd'
    : 'Ctrl';

/** A subtle square button holding one Fluent icon; the label is its accessible name and tooltip. */
export function IconButton({
  label,
  shortcut,
  onClick,
  disabled,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="ibtn"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
