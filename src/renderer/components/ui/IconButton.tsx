import type { ReactNode } from 'react';

export const modKey: 'Cmd' | 'Ctrl' =
  typeof navigator !== 'undefined' &&
  /Mac/.test(navigator.platform || navigator.userAgent)
    ? 'Cmd'
    : 'Ctrl';

export function IconButton({
  label,
  shortcut,
  tone = 'default',
  onClick,
  disabled,
  children,
}: {
  label: string;
  shortcut?: string;
  tone?: 'default' | 'accent' | 'green';
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`ibtn ibtn-${tone}`}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
