import type { CSSProperties } from 'react';

/** A repo's color (repoColor) as a dot or a bar; nothing for a single-repo task. */
export function RepoMark({
  color,
  shape = 'dot',
}: {
  color: number | null;
  shape?: 'dot' | 'bar';
}) {
  if (color === null) return null;
  return (
    <span
      aria-hidden="true"
      className={`repo-mark repo-mark-${shape}`}
      data-color={color}
      style={{ '--repo': `var(--repo-${color})` } as CSSProperties}
    />
  );
}
