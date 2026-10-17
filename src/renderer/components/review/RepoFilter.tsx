import {
  CheckmarkCircle12Filled,
  ChevronDown16Regular,
} from '@fluentui/react-icons';
import { type ReactNode, useCallback, useState } from 'react';
import { RepoMark } from '../RepoMark';
import { PopupMenu } from '../ui';

export type RepoChip = {
  workspaceId: string;
  name: string;
  color: number | null;
  /** Files not viewed yet; undefined when the repo is not listed in this scope. */
  unviewed?: number;
};

function Unviewed({ n }: { n?: number }) {
  if (n === 0)
    return (
      <CheckmarkCircle12Filled
        className="review-plus"
        aria-label="all viewed"
      />
    );
  if (n === undefined) return null;
  return (
    <span className="small muted" aria-label={`${n} not viewed`}>
      {n}
    </span>
  );
}

/** One dropdown for a multi-repo task: All repos or one repo; keys 0 to 9 pick them too. */
export function RepoFilter({
  chips,
  value,
  locked,
  onChange,
}: {
  chips: RepoChip[];
  value: string | null;
  /** Commits scope: the list is one repo's, the others cannot be picked. */
  locked: boolean;
  onChange: (workspaceId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  const current = chips.find((c) => c.workspaceId === value);
  const pick = (id: string | null) => {
    setOpen(false);
    onChange(id);
  };
  const item = (id: string | null, key: number, body: ReactNode) => {
    const off = locked && id !== value;
    return (
      <button
        key={id ?? 'all'}
        type="button"
        role="menuitemradio"
        aria-checked={id === value}
        className="menu-item review-repo-item"
        disabled={off}
        title={off ? 'Commits are per repo' : undefined}
        onClick={() => pick(id)}
      >
        <span className="menu-title">
          {body}
          <kbd className="small muted" aria-hidden="true">
            {key}
          </kbd>
        </span>
      </button>
    );
  };
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className="btn btn-sm review-repo-pick"
        aria-label={`Repos: ${current?.name ?? 'all'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={locked ? 'Commits are per repo' : 'Show one repo (0-9)'}
        onClick={() => setOpen(!open)}
      >
        {current ? (
          <>
            <RepoMark color={current.color} />
            {current.name}
          </>
        ) : (
          'All repos'
        )}
        <ChevronDown16Regular aria-hidden="true" />
      </button>
      <PopupMenu
        label="Repos"
        anchor={anchor}
        open={open}
        align="start"
        onClose={close}
      >
        {item(null, 0, 'All repos')}
        {chips.map((c, i) =>
          item(
            c.workspaceId,
            i + 1,
            <>
              <RepoMark color={c.color} />
              {c.name}
              <span className="review-repo-count">
                <Unviewed n={c.unviewed} />
              </span>
            </>,
          ),
        )}
      </PopupMenu>
    </>
  );
}
