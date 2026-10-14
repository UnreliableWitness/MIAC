import type { ReactNode } from 'react';
import { useStore } from '../store';

export function TopBar({
  children,
  crumb,
}: {
  children?: ReactNode;
  crumb?: string;
}) {
  const go = useStore((s) => s.go);
  return (
    <header className="topbar">
      <button
        type="button"
        className="brand"
        style={{ background: 'none', border: 'none', padding: 0 }}
        onClick={() => go({ kind: 'workspace' })}
      >
        MIAC
      </button>
      {crumb && <div className="muted">{crumb}</div>}
      {children}
    </header>
  );
}
