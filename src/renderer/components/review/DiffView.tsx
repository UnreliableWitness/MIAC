// src/renderer/components/review/DiffView.tsx
import type * as Monaco from 'monaco-editor';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReviewSide } from '../../../shared/review';
import { loadMonaco } from '../../review/loadMonaco';
import { type LineChange, mapOriginalLine } from '../../review/mapOriginalLine';

export type DiffZone = {
  id: string;
  side: ReviewSide;
  afterLine: number;
  node: ReactNode;
};
export type DiffKey = 'j' | 'k' | 'n' | 'p' | 'v' | 'c';
export type DiffViewHandle = {
  goToChange(dir: 'next' | 'previous'): void;
  selection(): { side: ReviewSide; startLine: number; endLine: number } | null;
  focus(): void;
};
type Props = {
  /** Unique per file (`<workspaceId>/<path>`); a new key is a new file, the same key keeps scroll and zones. */
  uriKey: string;
  before: string;
  after: string;
  sideBySide: boolean;
  ignoreWhitespace: boolean;
  hideUnchanged: boolean;
  zones?: DiffZone[];
  onGlyph?: (side: ReviewSide, line: number) => void;
  onKey?: (key: DiffKey) => void;
  onReady?: (h: DiffViewHandle | null) => void;
};

/** Events inside a comment card must not reach Monaco (its keybindings and mouse handling). */
const SHIELD = [
  'keydown',
  'keyup',
  'keypress',
  'mousedown',
  'pointerdown',
  'contextmenu',
  'paste',
  'copy',
  'cut',
];

export function DiffView(p: Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(p);
  latest.current = p;
  const [m, setM] = useState<typeof Monaco | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [diff, setDiff] = useState<Monaco.editor.IStandaloneDiffEditor | null>(
    null,
  );
  const [lineChanges, setLineChanges] = useState<LineChange[]>([]);
  const [mounted, setMounted] = useState<{ id: string; dom: HTMLElement }[]>(
    [],
  );

  useEffect(() => {
    let live = true;
    loadMonaco().then(
      (x) => live && setM(x),
      (e) => live && setFailed(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!m || !host.current) return;
    const font = getComputedStyle(document.documentElement)
      .getPropertyValue('--font-code')
      .trim();
    const d = m.editor.createDiffEditor(host.current, {
      theme: 'miac-dark',
      readOnly: true,
      originalEditable: false,
      domReadOnly: true,
      automaticLayout: true,
      glyphMargin: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderSideBySide: latest.current.sideBySide,
      // The Side by side toggle means what it says: no silent switch to inline on narrow windows.
      useInlineViewWhenSpaceIsLimited: false,
      ignoreTrimWhitespace: latest.current.ignoreWhitespace,
      hideUnchangedRegions: { enabled: latest.current.hideUnchanged },
      fontSize: 13,
      ...(font ? { fontFamily: font } : {}),
    });
    const sides: [ReviewSide, Monaco.editor.IStandaloneCodeEditor][] = [
      ['before', d.getOriginalEditor()],
      ['after', d.getModifiedEditor()],
    ];
    const subs: Monaco.IDisposable[] = [];
    const keys: [DiffKey, number][] = [
      ['j', m.KeyCode.KeyJ],
      ['k', m.KeyCode.KeyK],
      ['n', m.KeyCode.KeyN],
      ['p', m.KeyCode.KeyP],
      ['v', m.KeyCode.KeyV],
      ['c', m.KeyCode.KeyC],
    ];
    for (const [side, ed] of sides) {
      let hover: string[] = [];
      subs.push(
        ed.onMouseMove((e) => {
          const line = e.target.position?.lineNumber;
          hover = ed.deltaDecorations(
            hover,
            line && latest.current.onGlyph
              ? [
                  {
                    range: new m.Range(line, 1, line, 1),
                    options: { glyphMarginClassName: 'review-add-glyph' },
                  },
                ]
              : [],
          );
        }),
        ed.onMouseLeave(() => {
          hover = ed.deltaDecorations(hover, []);
        }),
        ed.onMouseDown((e) => {
          if (
            e.target.type === m.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
            e.target.position
          )
            latest.current.onGlyph?.(side, e.target.position.lineNumber);
        }),
      );
      // Plain letters only (Cmd/Ctrl+C still copies). An action is scoped to this editor, and
      // `editorTextFocus` keeps the letters typeable in the find widget.
      for (const [key, code] of keys)
        subs.push(
          ed.addAction({
            id: `miac.review.${key}`,
            label: `Review: ${key}`,
            keybindings: [code],
            keybindingContext: 'editorTextFocus',
            run: () => latest.current.onKey?.(key),
          }),
        );
    }
    subs.push(
      d.onDidUpdateDiff(() => setLineChanges(d.getLineChanges() ?? [])),
    );
    const handle: DiffViewHandle = {
      goToChange: (dir) => d.goToDiff(dir),
      // In the inline view only the modified editor is shown, so the "+" and the selection
      // offer the after side only.
      selection: () => {
        const focused = sides.find(([, ed]) => ed.hasTextFocus()) ?? sides[1];
        const s = focused[1].getSelection();
        if (!s) return null;
        // A selection that ends at column 1 of the next line covers the lines above it.
        const end =
          s.endLineNumber > s.startLineNumber && s.endColumn === 1
            ? s.endLineNumber - 1
            : s.endLineNumber;
        return { side: focused[0], startLine: s.startLineNumber, endLine: end };
      },
      focus: () => d.getModifiedEditor().focus(),
    };
    setDiff(d);
    latest.current.onReady?.(handle);
    return () => {
      latest.current.onReady?.(null);
      for (const s of subs) s.dispose();
      const model = d.getModel();
      d.dispose();
      model?.original.dispose();
      model?.modified.dispose();
      setDiff(null);
    };
  }, [m]);

  useEffect(() => {
    diff?.updateOptions({
      renderSideBySide: p.sideBySide,
      ignoreTrimWhitespace: p.ignoreWhitespace,
      hideUnchangedRegions: { enabled: p.hideUnchanged },
    });
  }, [diff, p.sideBySide, p.ignoreWhitespace, p.hideUnchanged]);

  useEffect(() => {
    if (!m || !diff) return;
    const uri = (side: ReviewSide) =>
      m.Uri.from({ scheme: 'miac-review', path: `/${side}/${p.uriKey}` });
    const cur = diff.getModel();
    if (cur && cur.modified.uri.toString() === uri('after').toString()) {
      // The same file changed on disk: keep the reader's place.
      const view = diff.saveViewState();
      if (cur.original.getValue() !== p.before) cur.original.setValue(p.before);
      if (cur.modified.getValue() !== p.after) cur.modified.setValue(p.after);
      if (view) diff.restoreViewState(view);
      return;
    }
    const original = m.editor.createModel(p.before, undefined, uri('before'));
    const modified = m.editor.createModel(p.after, undefined, uri('after'));
    diff.setModel({ original, modified });
    cur?.original.dispose();
    cur?.modified.dispose();
  }, [m, diff, p.uriKey, p.before, p.after]);

  const zoneSig = useMemo(
    () =>
      JSON.stringify((p.zones ?? []).map((z) => [z.id, z.side, z.afterLine])),
    [p.zones],
  );
  // Inline, before-side zones sit in the modified editor at mapped lines, so they move with the diff.
  const inlineMap = p.sideBySide ? '' : JSON.stringify(lineChanges);

  useEffect(() => {
    if (!diff) return;
    const eds = {
      before: diff.getOriginalEditor(),
      after: diff.getModifiedEditor(),
    };
    const inline = !latest.current.sideBySide;
    const changes: LineChange[] = inline
      ? (JSON.parse(inlineMap) as LineChange[])
      : [];
    const made: {
      id: string;
      host: ReviewSide;
      zoneId: string;
      zone: Monaco.editor.IViewZone;
      inner: HTMLElement;
      ro: ResizeObserver;
    }[] = [];
    // The inline view hides the original editor: every zone goes to the modified one there.
    const placed = (latest.current.zones ?? []).map((z) => ({
      z,
      host: inline ? ('after' as const) : z.side,
      line:
        inline && z.side === 'before'
          ? mapOriginalLine(z.afterLine, changes)
          : z.afterLine,
    }));
    for (const host of ['before', 'after'] as const) {
      eds[host].changeViewZones((acc) => {
        for (const { z, line } of placed.filter((x) => x.host === host)) {
          const dom = document.createElement('div');
          dom.className = 'review-zone';
          for (const ev of SHIELD)
            dom.addEventListener(ev, (e) => e.stopPropagation());
          const inner = document.createElement('div');
          dom.appendChild(inner);
          const zone: Monaco.editor.IViewZone = {
            afterLineNumber: line,
            heightInPx: 96,
            domNode: dom,
            suppressMouseDown: true,
          };
          const zoneId = acc.addZone(zone);
          const ro = new ResizeObserver(() => {
            const h = inner.offsetHeight + 8;
            if (h > 8 && Math.abs(h - (zone.heightInPx ?? 0)) > 1) {
              zone.heightInPx = h;
              eds[host].changeViewZones((a) => a.layoutZone(zoneId));
            }
          });
          ro.observe(inner);
          made.push({ id: z.id, host, zoneId, zone, inner, ro });
        }
      });
    }
    setMounted(made.map((x) => ({ id: x.id, dom: x.inner })));
    return () => {
      for (const x of made) x.ro.disconnect();
      for (const host of ['before', 'after'] as const)
        eds[host].changeViewZones((acc) => {
          for (const x of made) if (x.host === host) acc.removeZone(x.zoneId);
        });
      setMounted([]);
    };
    // Zones are rebuilt when their ids or lines change, a new file is shown (setModel clears
    // them), the view switches between side by side and inline, or (inline) the diff changes.
  }, [diff, zoneSig, p.uriKey, p.sideBySide, inlineMap]);

  const nodes = new Map((p.zones ?? []).map((z) => [z.id, z.node]));
  if (failed)
    return (
      <div className="review-empty">{`The diff viewer could not load: ${failed}`}</div>
    );
  return (
    <>
      <div ref={host} className="review-diff" />
      {mounted.map((x) => createPortal(nodes.get(x.id) ?? null, x.dom, x.id))}
    </>
  );
}
