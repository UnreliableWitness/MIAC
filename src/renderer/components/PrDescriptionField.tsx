const ELLIPSIS = String.fromCharCode(0x2026);

/** A PR's "what changed and why" on the Finish page (#111): written by Claude Code, edited by the user. */
export type PrDraft = {
  status: 'writing' | 'ready' | 'failed' | 'skipped';
  text: string;
  error: string | null;
};

export function PrDescriptionField({
  draft,
  onChange,
  onRewrite,
  onSkip,
}: {
  draft: PrDraft;
  onChange: (text: string) => void;
  onRewrite: () => void;
  onSkip: () => void;
}) {
  const writing = draft.status === 'writing';
  return (
    <div className="pr-summary">
      <div className="pr-summary-head">
        <span className="small">What changed and why</span>
        {writing ? (
          <>
            <span className="muted small">{`Claude Code is writing it${ELLIPSIS}`}</span>
            <button
              type="button"
              className="btn btn-subtle btn-sm"
              onClick={onSkip}
            >
              Skip
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-subtle btn-sm"
            onClick={onRewrite}
          >
            Write again
          </button>
        )}
      </div>
      <textarea
        className="field"
        aria-label="Pull request description"
        rows={9}
        value={draft.text}
        disabled={writing}
        placeholder="The PR description starts with this text (Markdown). Leave it empty for the commit list only."
        onChange={(e) => onChange(e.target.value)}
      />
      {draft.status === 'failed' && (
        <div className="muted small">{`Not written: ${draft.error ?? 'unknown error'}. Type one here, or leave it empty for the commit list only.`}</div>
      )}
      <div className="muted small">The commit list follows it.</div>
    </div>
  );
}
