// src/renderer/components/OpenInEditor.tsx
import { ChevronDown16Regular, Code16Regular } from '@fluentui/react-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  EDITOR_LABELS,
  type EditorId,
  type EditorOptions,
} from '../../shared/editors';
import { api, tryInvoke } from '../api';
import { useStore } from '../store';
import { PopupMenu } from './ui';

const fileName = (p: string) => p.split(/[\\/]/).at(-1) ?? p;

/** Opens the worktree in the developer's editor; the menu holds the other editors and Visual Studio's solutions. */
export function OpenInEditor({
  taskId,
  workspaceId,
  disabled,
  visible = true,
}: {
  taskId: string;
  workspaceId?: string;
  disabled?: boolean;
  /** A hidden row keeps its state; options load again when it shows or its menu opens. */
  visible?: boolean;
}) {
  const notify = useStore((s) => s.notify);
  const go = useStore((s) => s.go);
  const [opts, setOpts] = useState<EditorOptions | null>(null);
  const [menu, setMenu] = useState(false);
  // Counts menu openings: options load again on open, not on close.
  const [opens, setOpens] = useState(0);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const close = useCallback(() => setMenu(false), []);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    void api()
      .invoke('editor:options', taskId, workspaceId)
      .then((o) => {
        if (live) setOpts(o);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [taskId, workspaceId, visible, opens]);

  const open = (o: { editorId?: EditorId; solution?: string } = {}) => {
    setMenu(false);
    void tryInvoke(
      () => api().invoke('editor:openFolder', taskId, workspaceId, o),
      notify,
    );
  };

  if (opts && !opts.chosen)
    return (
      <button
        type="button"
        className="btn btn-subtle btn-sm"
        onClick={() => go({ kind: 'settings' })}
      >
        No editor found
      </button>
    );
  const label = opts?.chosen ? EDITOR_LABELS[opts.chosen] : 'editor';
  const others = opts?.editors.filter((e) => e.id !== opts.chosen) ?? [];
  const solutions =
    opts?.chosen === 'visualstudio' && opts.solutions.length > 1
      ? opts.solutions
      : [];
  return (
    <span className="split-btn">
      <button
        type="button"
        className="btn btn-subtle btn-sm"
        disabled={disabled || !opts}
        title={`Open in ${label}`}
        onClick={() => open()}
      >
        <Code16Regular aria-hidden="true" />
        {/* A narrow task bar keeps the icon only; the text stays the button's name. */}
        <span className="open-in-label">{`Open in ${label}`}</span>
      </button>
      {(others.length > 0 || solutions.length > 0) && (
        <button
          ref={setAnchor}
          type="button"
          className="btn btn-subtle btn-sm"
          aria-label="More ways to open"
          aria-haspopup="menu"
          aria-expanded={menu}
          disabled={disabled}
          onClick={() => {
            if (!menu) setOpens((n) => n + 1);
            setMenu(!menu);
          }}
        >
          <ChevronDown16Regular aria-hidden="true" />
        </button>
      )}
      <PopupMenu
        label="Open in editor"
        anchor={anchor}
        open={menu}
        onClose={close}
      >
        {solutions.map((s) => (
          <button
            key={s}
            type="button"
            role="menuitem"
            className="menu-item"
            aria-label={`Open ${fileName(s)}`}
            onClick={() => open({ solution: s })}
          >
            <span className="menu-title">{`Open ${fileName(s)}`}</span>
            <span className="small muted mono">{s}</span>
          </button>
        ))}
        {others.map((e) => (
          <button
            key={e.id}
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => open({ editorId: e.id })}
          >
            <span className="menu-title">{`Open in ${e.label}`}</span>
          </button>
        ))}
      </PopupMenu>
    </span>
  );
}
