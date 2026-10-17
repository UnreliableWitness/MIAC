import { useState } from 'react';
import {
  isGenerated,
  type ReviewFile,
  type ReviewRepo,
  viewedKey,
} from '../../../shared/review';

export type FileRef = { workspaceId: string; path: string };
const STATUS_LABEL = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
} as const;
const split = (p: string) => {
  const i = p.lastIndexOf('/');
  return i < 0
    ? { dir: '', name: p }
    : { dir: p.slice(0, i + 1), name: p.slice(i + 1) };
};

function Row({
  file,
  selected,
  viewedHash,
  comments,
  onSelect,
  onViewed,
}: {
  file: ReviewFile;
  selected: boolean;
  viewedHash: string | undefined;
  comments: number;
  onSelect: () => void;
  onViewed: (on: boolean) => void;
}) {
  const { dir, name } = split(file.path);
  const viewed = viewedHash === file.hash;
  const changedSince = viewedHash !== undefined && !viewed;
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      className={`review-file${selected ? ' selected' : ''}`}
      onClick={onSelect}
    >
      <span
        className={`review-status review-status-${file.status}`}
        title={STATUS_LABEL[file.status]}
      >
        {file.status}
      </span>
      <span
        className="review-name"
        title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      >
        <span>{name}</span>
        {dir && <span className="muted small"> {dir}</span>}
        {changedSince && (
          <span className="tag tag-warn review-changed">
            Changed since viewed
          </span>
        )}
      </span>
      {comments > 0 && (
        <span
          className="small review-count"
          aria-label={`${comments} comments`}
        >
          {comments}
        </span>
      )}
      <span className="small mono review-stat">
        {file.binary ? (
          'bin'
        ) : (
          <>
            <span className="review-plus">+{file.added}</span>{' '}
            <span className="review-minus">−{file.removed}</span>
          </>
        )}
      </span>
      <input
        type="checkbox"
        aria-label={`Viewed ${file.path}`}
        checked={viewed}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onViewed(e.target.checked)}
      />
    </div>
  );
}

/** Changed files per repo; generated files (lock files, dist, the repo's review.collapse) folded away. */
export function FileTree({
  repos,
  selected,
  viewed,
  commentCount,
  onSelect,
  onViewed,
}: {
  repos: ReviewRepo[];
  selected: FileRef | null;
  viewed: Record<string, string>;
  commentCount: (ref: FileRef) => number;
  onSelect: (ref: FileRef) => void;
  onViewed: (repo: ReviewRepo, file: ReviewFile, on: boolean) => void;
}) {
  const [openGenerated, setOpenGenerated] = useState<Record<string, boolean>>(
    {},
  );
  const grouped = repos.length > 1;
  return (
    <div role="tree" aria-label="Changed files" className="review-tree">
      {repos.map((r) => {
        const normal = r.files.filter((f) => !isGenerated(f.path, r.collapse));
        const generated = r.files.filter((f) =>
          isGenerated(f.path, r.collapse),
        );
        const row = (f: ReviewFile) => (
          <Row
            key={f.path}
            file={f}
            selected={
              selected?.workspaceId === r.workspaceId &&
              selected.path === f.path
            }
            viewedHash={viewed[viewedKey(r.workspaceId, f.path)]}
            comments={commentCount({
              workspaceId: r.workspaceId,
              path: f.path,
            })}
            onSelect={() =>
              onSelect({ workspaceId: r.workspaceId, path: f.path })
            }
            onViewed={(on) => onViewed(r, f, on)}
          />
        );
        return (
          <div
            key={r.workspaceId}
            role="group"
            aria-label={r.name}
            className="review-repo"
          >
            {grouped && <div className="review-repo-name">{r.name}</div>}
            {r.error && (
              <div role="alert" className="review-repo-error small">
                {r.error}
              </div>
            )}
            {normal.map(row)}
            {generated.length > 0 && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm review-generated"
                  aria-expanded={Boolean(openGenerated[r.workspaceId])}
                  onClick={() =>
                    setOpenGenerated({
                      ...openGenerated,
                      [r.workspaceId]: !openGenerated[r.workspaceId],
                    })
                  }
                >
                  {`Generated (${generated.length})`}
                </button>
                {openGenerated[r.workspaceId] && generated.map(row)}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
