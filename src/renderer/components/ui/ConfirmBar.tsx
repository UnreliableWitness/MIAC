// src/renderer/components/ui/ConfirmBar.tsx
import { type ReactNode, useEffect, useId, useRef } from 'react';

/**
 * An in-page confirmation for an action that cannot be undone: the question, the action and Cancel.
 * Cancel has the focus, so Enter never confirms by accident; Escape cancels too. Focus goes back to
 * where it was when the bar closes, if that element is still on the page.
 */
export function ConfirmBar({
  message,
  details,
  confirmLabel,
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  message: string;
  /** More about what the action does, under the question. */
  details?: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  /** The action waits (Cancel stays usable), e.g. while what it would lose is being checked. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, []);
  return (
    <div
      role="alertdialog"
      aria-labelledby={id}
      className="confirm-bar"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <span id={id} className="confirm-bar-text">
        {message}
        {details && <span className="confirm-bar-details">{details}</span>}
      </span>
      <span className="confirm-bar-actions">
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={busy || confirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button
          ref={cancel}
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </span>
    </div>
  );
}
