// src/renderer/components/review/CommentsList.tsx
import type { MouseEvent } from 'react';
import type { ReviewComment } from '../../../shared/review';

const ORDER = { open: 0, sent: 1, outdated: 2, resolved: 3 } as const;

/**
 * Every comment of the task, unresolved first; a click opens its file at its line. Each row resolves,
 * reopens and deletes on its own, so a comment whose file left the change list can still be closed.
 */
export function CommentsList({
  comments,
  repoName,
  multiRepo,
  onOpen,
  onResolve,
  onReopen,
  onDelete,
}: {
  comments: ReviewComment[];
  repoName: (workspaceId: string) => string;
  multiRepo: boolean;
  onOpen: (c: ReviewComment) => void;
  onResolve: (c: ReviewComment) => void;
  onReopen: (c: ReviewComment) => void;
  onDelete: (c: ReviewComment) => void;
}) {
  if (comments.length === 0)
    return (
      <div className="review-empty small">
        No comments yet. Hover a line and click + to add one.
      </div>
    );
  const sorted = [...comments].sort(
    (a, b) =>
      ORDER[a.status] - ORDER[b.status] ||
      a.createdAt.localeCompare(b.createdAt),
  );
  // An action stays on the list: it does not open the comment's file.
  const act = (run: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    run();
  };
  return (
    <div role="list" aria-label="Comments" className="review-comments">
      {sorted.map((c) => (
        <div
          key={c.id}
          role="listitem"
          className={`review-comment-row review-card-${c.status}`}
          onClick={() => onOpen(c)}
        >
          <button type="button" className="review-comment-open">
            <span className="mono small">{`${multiRepo ? `${repoName(c.workspaceId)}/` : ''}${c.path}:${c.startLine}`}</span>
            <span className="small review-comment-text">{c.text}</span>
            <span className="small muted">{c.status}</span>
          </button>
          <span className="review-comment-actions">
            {c.status === 'resolved' ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={act(() => onReopen(c))}
              >
                Reopen
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={act(() => onResolve(c))}
              >
                Resolve
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={act(() => onDelete(c))}
            >
              Delete
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
