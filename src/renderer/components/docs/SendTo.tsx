import { ChevronDown16Regular } from '@fluentui/react-icons';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TaskView } from '../../../shared/types';
import { api } from '../../api';
import { readSendTarget, writeSendTarget } from '../../docs/docsPrefs';
import { buildQuote } from '../../docs/quote';
import { useStore } from '../../store';
import { focusTerminal, pasteInto } from '../../terminalRegistry';
import { track } from '../../telemetry';

/**
 * A triple click ends at offset 0 of the next block; that block is not part of the selection,
 * so use the last text node that lies before the end point instead.
 */
function endNode(range: Range): Node {
  if (range.endOffset > 0) return range.endContainer;
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
  );
  let last: Node | null = null;
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (
      n.textContent?.trim() &&
      range.comparePoint(n, 0) >= 0 &&
      n.compareDocumentPosition(range.endContainer) &
        Node.DOCUMENT_POSITION_FOLLOWING &&
      !n.contains(range.endContainer)
    )
      last = n;
  }
  return last ?? range.endContainer;
}

export function selectionLines(
  range: Range,
): { start: number; end: number } | null {
  const el = (n: Node) =>
    n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement;
  const block = (n: Node) =>
    el(n)?.closest('[data-line],[data-line-start]') as HTMLElement | null;
  const a = block(range.startContainer);
  const b = block(endNode(range));
  if (!a || !b) return null;
  const s = (x: HTMLElement) => Number(x.dataset.line ?? x.dataset.lineStart);
  const e = (x: HTMLElement) => Number(x.dataset.line ?? x.dataset.lineEnd);
  const start = Math.min(s(a), s(b));
  const end = Math.max(e(a), e(b));
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

/** Selection text with a line break between sibling blocks (jsdom's toString runs them together). */
function selectionText(sel: Selection): string {
  if (sel.rangeCount === 0) return '';
  const kids = Array.from(sel.getRangeAt(0).cloneContents().children);
  return kids.length > 1
    ? kids.map((k) => k.textContent ?? '').join('\n')
    : sel.toString();
}

type Shown = { start: number; end: number; top: number; left: number };

export function SendTo({
  task,
  container,
  path,
  view,
}: {
  task: TaskView;
  container: HTMLElement | null;
  path: string;
  view: 'rendered' | 'source';
}) {
  const notify = useStore((s) => s.notify);
  const [shown, setShown] = useState<Shown | null>(null);
  const [menu, setMenu] = useState<Record<string, boolean> | null>(null);
  const [chosen, setChosen] = useState<string | null>(() =>
    readSendTarget(task.id),
  );

  const hide = useCallback(() => {
    setShown(null);
    setMenu(null);
  }, []);

  // A new document or view invalidates any selection.
  useEffect(() => hide(), [path, view, hide]);

  useEffect(() => {
    if (!container) return;
    const onChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString()) {
        hide();
        return;
      }
      const range = sel.getRangeAt(0);
      if (
        !container.contains(range.startContainer) ||
        !container.contains(range.endContainer)
      ) {
        hide();
        return;
      }
      const lines = selectionLines(range);
      if (!lines) {
        hide();
        return;
      }
      const r = range.getBoundingClientRect?.() ?? { bottom: 0, right: 0 };
      const c = container.getBoundingClientRect();
      setShown({
        ...lines,
        top: (r.bottom || c.top) - c.top + container.scrollTop + 4,
        left: Math.max(
          0,
          (r.right || c.left) - c.left + container.scrollLeft - 8,
        ),
      });
      setMenu(null);
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [container, hide]);

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shown, hide]);

  if (!container || !shown || task.terminals.length === 0) return null;

  const terminals = task.terminals;
  const defaultTarget =
    terminals.find((t) => t.id === chosen) ??
    terminals.find((t) => t.kind === 'claude' || t.kind === 'copilot') ??
    terminals[0];

  const send = async (id: string) => {
    const target = terminals.find((t) => t.id === id);
    if (!target) return;
    const sel = window.getSelection();
    const text = sel ? selectionText(sel) : '';
    let running = false;
    try {
      running = Boolean(await api().invoke('terminals:isRunning', id));
    } catch {
      running = false;
    }
    if (!running) {
      notify('warn', 'That terminal is not running');
      return;
    }
    const ok = pasteInto(id, (b) =>
      buildQuote(path, shown.start, shown.end, text, { singleLine: !b }),
    );
    if (!ok) {
      notify('warn', 'That terminal is not open');
      return;
    }
    writeSendTarget(task.id, id);
    setChosen(id);
    useStore.getState().setTab(task.id, id);
    requestAnimationFrame(() => focusTerminal(id));
    track('docs.sentTo', { kind: target.kind });
    window.getSelection()?.removeAllRanges();
    hide();
  };

  const openMenu = async () => {
    if (menu) {
      setMenu(null);
      return;
    }
    const states: Record<string, boolean> = {};
    await Promise.all(
      terminals.map(async (t) => {
        try {
          states[t.id] = Boolean(
            await api().invoke('terminals:isRunning', t.id),
          );
        } catch {
          states[t.id] = false;
        }
      }),
    );
    setMenu(states);
  };

  return createPortal(
    <div
      className="docs-sendto"
      style={{ top: shown.top, left: shown.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => void send(defaultTarget.id)}
      >
        Send to {defaultTarget.label}
      </button>
      <button
        type="button"
        className="btn btn-primary btn-sm docs-sendto-chev"
        aria-label="Choose terminal"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={() => void openMenu()}
      >
        <ChevronDown16Regular aria-hidden="true" />
      </button>
      {menu && (
        <div className="docs-sendto-menu" role="menu">
          {terminals.map((t) => {
            const off = !menu[t.id];
            return (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                className="docs-sendto-item"
                aria-disabled={off ? 'true' : undefined}
                onClick={() => {
                  if (!off) void send(t.id);
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}
    </div>,
    container,
  );
}
