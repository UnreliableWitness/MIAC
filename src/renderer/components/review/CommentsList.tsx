// src/renderer/components/review/CommentsList.tsx
import type { ReviewComment } from '../../../shared/review';

const ORDER = { open: 0, sent: 1, outdated: 2, resolved: 3 } as const;

/** Every comment of the task, unresolved first; a click opens its file at its line. */
export function CommentsList({
  comments,
  repoName,
  multiRepo,
  onOpen,
}: {
  comments: ReviewComment[];
  repoName: (workspaceId: string) => string;
  multiRepo: boolean;
  onOpen: (c: ReviewComment) => void;
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
  return (
    <div role="list" aria-label="Comments" className="review-comments">
      {sorted.map((c) => (
        <button
          key={c.id}
          type="button"
          role="listitem"
          className={`review-comment-row review-card-${c.status}`}
          onClick={() => onOpen(c)}
        >
          <span className="mono small">{`${multiRepo ? `${repoName(c.workspaceId)}/` : ''}${c.path}:${c.startLine}`}</span>
          <span className="small review-comment-text">{c.text}</span>
          <span className="small muted">{c.status}</span>
        </button>
      ))}
    </div>
  );
}
