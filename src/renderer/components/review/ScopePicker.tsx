import { ChevronDown16Regular } from '@fluentui/react-icons';
import { useCallback, useState } from 'react';
import type { ReviewRepo, ReviewScope } from '../../../shared/review';
import { PopupMenu } from '../ui';

const short = (sha: string) => sha.slice(0, 7);

/** All changes / Uncommitted / Commits (one commit, or a range with Shift). */
export function ScopePicker({
  scope,
  repos,
  onChange,
}: {
  scope: ReviewScope;
  repos: ReviewRepo[];
  onChange: (s: ReviewScope) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const withCommits = repos.filter((r) => r.commits.length > 0);
  const pick = (r: ReviewRepo, index: number, range: boolean) => {
    const sha = r.commits[index].sha;
    if (
      range &&
      scope.kind === 'commits' &&
      scope.workspaceId === r.workspaceId
    ) {
      // Commits are newest first: the older end of the range has the higher index.
      const ia = r.commits.findIndex((c) => c.sha === scope.from);
      const lo = Math.max(ia, index);
      const hi = Math.min(
        r.commits.findIndex((c) => c.sha === scope.to),
        index,
      );
      onChange({
        kind: 'commits',
        workspaceId: r.workspaceId,
        from: r.commits[lo].sha,
        to: r.commits[hi].sha,
      });
    } else
      onChange({
        kind: 'commits',
        workspaceId: r.workspaceId,
        from: sha,
        to: sha,
      });
    setOpen(false);
  };
  const commitLabel =
    scope.kind === 'commits'
      ? scope.from === scope.to
        ? `Commit ${short(scope.from)}`
        : `${short(scope.from)}..${short(scope.to)}`
      : 'Commits';
  return (
    <div className="review-scope" role="group" aria-label="Scope">
      <button
        type="button"
        className="btn btn-sm"
        aria-pressed={scope.kind === 'all'}
        onClick={() => onChange({ kind: 'all' })}
      >
        All changes
      </button>
      <button
        type="button"
        className="btn btn-sm"
        aria-pressed={scope.kind === 'uncommitted'}
        onClick={() => onChange({ kind: 'uncommitted' })}
      >
        Uncommitted
      </button>
      <button
        ref={setAnchor}
        type="button"
        className="btn btn-sm"
        aria-label="Commits"
        aria-pressed={scope.kind === 'commits'}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={withCommits.length === 0}
        onClick={() => setOpen(!open)}
      >
        {commitLabel}
        <ChevronDown16Regular aria-hidden="true" />
      </button>
      <PopupMenu label="Commits" anchor={anchor} open={open} onClose={close}>
        {withCommits.map((r) =>
          r.commits.map((c, i) => (
            <button
              key={`${r.workspaceId}:${c.sha}`}
              type="button"
              role="menuitem"
              className="menu-item"
              aria-label={`${c.subject} ${short(c.sha)}`}
              onClick={(e) => pick(r, i, e.shiftKey)}
            >
              <span className="menu-title">{c.subject}</span>
              <span className="small muted mono">
                {`${withCommits.length > 1 ? `${r.name} · ` : ''}${short(c.sha)} · ${c.author}`}
              </span>
            </button>
          )),
        )}
        <div className="small muted review-scope-hint">
          Shift-click a second commit for a range.
        </div>
      </PopupMenu>
    </div>
  );
}
