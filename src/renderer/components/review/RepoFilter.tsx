import { CheckmarkCircle12Filled } from '@fluentui/react-icons';
import { RepoMark } from '../RepoMark';

export type RepoChip = {
  workspaceId: string;
  name: string;
  color: number | null;
  /** Files not viewed yet; undefined when the repo is not listed in this scope. */
  unviewed?: number;
};

/** All plus one chip per repo of a multi-repo task; keys 0 to 9 pick them. */
export function RepoFilter({
  chips,
  value,
  locked,
  onChange,
}: {
  chips: RepoChip[];
  value: string | null;
  /** Commits scope: the list is one repo's, the other chips cannot be picked. */
  locked: boolean;
  onChange: (workspaceId: string | null) => void;
}) {
  return (
    <div className="review-repos" role="group" aria-label="Repos">
      <button
        type="button"
        className="btn btn-sm"
        aria-pressed={value === null}
        disabled={locked}
        title={locked ? 'Commits are per repo' : 'All repos (0)'}
        onClick={() => onChange(null)}
      >
        All
      </button>
      {chips.map((c, i) => {
        const off = locked && c.workspaceId !== value;
        return (
          <button
            key={c.workspaceId}
            type="button"
            className="btn btn-sm review-repo-chip"
            aria-pressed={value === c.workspaceId}
            disabled={off}
            title={off ? 'Commits are per repo' : `${c.name} (${i + 1})`}
            onClick={() => onChange(c.workspaceId)}
          >
            <RepoMark color={c.color} />
            {c.name}
            {c.unviewed === 0 ? (
              <CheckmarkCircle12Filled
                className="review-plus"
                aria-label="all viewed"
              />
            ) : (
              c.unviewed !== undefined && (
                <span
                  className="small muted"
                  aria-label={`${c.unviewed} not viewed`}
                >
                  {c.unviewed}
                </span>
              )
            )}
          </button>
        );
      })}
    </div>
  );
}
