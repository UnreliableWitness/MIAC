// src/renderer/components/review/CommentCard.tsx
import { type KeyboardEvent, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReviewComment } from '../../../shared/review';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const lines = (c: Pick<ReviewComment, 'startLine' | 'endLine'>) =>
  c.startLine === c.endLine
    ? `Line ${c.startLine}`
    : `Lines ${c.startLine}-${c.endLine}`;

/**
 * A comment editor. Controlled with `value` and `onChange` (the draft lives with its owner, so it
 * survives a remount of its diff zone), or uncontrolled from `initial`.
 */
export function CommentBox({
  initial = '',
  value,
  onChange,
  saveLabel = 'Comment',
  onSave,
  onCancel,
}: {
  initial?: string;
  value?: string;
  onChange?: (text: string) => void;
  saveLabel?: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [own, setOwn] = useState(initial);
  const text = value ?? own;
  const setText = (t: string) => {
    if (value === undefined) setOwn(t);
    onChange?.(t);
  };
  const save = () => {
    if (text.trim()) onSave(text.trim());
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <div className="review-card review-box">
      <textarea
        className="field"
        aria-label="Comment"
        autoFocus
        rows={3}
        value={text}
        placeholder="What should change here? Markdown works."
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
      />
      <div className="review-card-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!text.trim()}
          onClick={save}
        >
          {saveLabel}
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function CommentCard({
  comment: c,
  onEdit,
  onResolve,
  onReopen,
  onDelete,
  onOpen,
}: {
  comment: ReviewComment;
  onEdit: (text: string) => void;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onOpen?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <CommentBox
        initial={c.text}
        saveLabel="Save"
        onSave={(t) => {
          setEditing(false);
          onEdit(t);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  const status =
    c.status === 'sent'
      ? `Sent ${c.sentAt ? time(c.sentAt) : ''}`.trim()
      : c.status === 'outdated'
        ? c.sentAt
          ? 'Code changed, probably addressed'
          : 'Code changed'
        : c.status === 'resolved'
          ? 'Resolved'
          : 'Open';
  return (
    <div className={`review-card review-card-${c.status}`}>
      <div className="review-card-head small">
        <span
          className={`tag${c.status === 'outdated' ? ' tag-warn' : c.status === 'sent' ? ' tag-green' : ''}`}
        >
          {status}
        </span>
        {onOpen ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm mono"
            onClick={onOpen}
          >
            {`${c.path}:${c.startLine}`}
          </button>
        ) : (
          <span className="muted">{lines(c)}</span>
        )}
      </div>
      {c.status === 'outdated' && (
        <pre className="review-snippet mono small">{c.snippet}</pre>
      )}
      <div className="review-card-text">
        <Markdown remarkPlugins={[remarkGfm]}>{c.text}</Markdown>
      </div>
      <div className="review-card-actions">
        {c.status === 'resolved' ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onReopen}
          >
            Reopen
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onResolve}
          >
            Resolve
          </button>
        )}
        {c.status !== 'resolved' && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
