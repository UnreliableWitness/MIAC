// src/renderer/components/review/DiffView.test.tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentCard } from './CommentCard';
import { setTestColorScheme } from '../../testColorScheme';
import { DiffView, type DiffZone } from './DiffView';

// Monaco does not run in jsdom: a stand-in with just what DiffView calls. View zones are real DOM
// nodes in a host per editor, added and removed like Monaco does.
const fake = vi.hoisted(() => {
  type Zone = { domNode: HTMLElement; onDomNodeTop?: (top: number) => void };
  const disp = { dispose: () => undefined };
  const restored: unknown[] = [];
  let saved = 0;
  const editor = () => {
    const host = document.createElement('div');
    let seq = 0;
    const zones = new Map<string, Zone>();
    const widgets = new Set<HTMLElement>();
    return {
      host,
      zones,
      widgets,
      getLayoutInfo: () => ({
        width: 600,
        contentLeft: 60,
        verticalScrollbarWidth: 14,
        minimap: { minimapWidth: 0 },
      }),
      onDidLayoutChange: () => disp,
      addOverlayWidget: (w: { getDomNode: () => HTMLElement }) => {
        widgets.add(w.getDomNode());
        host.appendChild(w.getDomNode());
      },
      removeOverlayWidget: (w: { getDomNode: () => HTMLElement }) => {
        widgets.delete(w.getDomNode());
        w.getDomNode().remove();
      },
      onMouseMove: () => disp,
      onMouseLeave: () => disp,
      onMouseDown: () => disp,
      addAction: () => disp,
      deltaDecorations: () => [],
      hasTextFocus: () => false,
      getSelection: () => null,
      focus: () => undefined,
      setPosition: () => undefined,
      revealLineInCenter: () => undefined,
      changeViewZones: (
        cb: (acc: {
          addZone: (z: Zone) => string;
          removeZone: (id: string) => void;
          layoutZone: (id: string) => void;
        }) => void,
      ) =>
        cb({
          addZone: (z) => {
            const id = `z${++seq}`;
            zones.set(id, z);
            host.appendChild(z.domNode);
            return id;
          },
          removeZone: (id) => {
            zones.get(id)?.domNode.remove();
            zones.delete(id);
          },
          layoutZone: () => undefined,
        }),
    };
  };
  type Model = {
    uri: { toString: () => string };
    getValue: () => string;
    setValue: (v: string) => void;
    dispose: () => void;
  };
  const monaco = {
    KeyCode: { KeyJ: 1, KeyK: 2, KeyN: 3, KeyP: 4, KeyV: 5, KeyC: 6 },
    Range: class {},
    Uri: {
      from: (u: { scheme: string; path: string }) => ({
        toString: () => `${u.scheme}:${u.path}`,
      }),
    },
    editor: {
      MouseTargetType: { GUTTER_GLYPH_MARGIN: 2 },
      createModel: (value: string, _l: unknown, uri: Model['uri']): Model => {
        let v = value;
        return {
          uri,
          getValue: () => v,
          setValue: (x) => (v = x),
          dispose: () => undefined,
        };
      },
      setTheme: vi.fn(),
      createDiffEditor: (host: HTMLElement, _options?: { theme?: string }) => {
        const original = editor();
        const modified = editor();
        host.append(original.host, modified.host);
        let model: { original: Model; modified: Model } | null = null;
        return {
          getOriginalEditor: () => original,
          getModifiedEditor: () => modified,
          onDidUpdateDiff: () => disp,
          getLineChanges: () => [],
          getModel: () => model,
          setModel: (m: typeof model) => (model = m),
          dispose: () => undefined,
          updateOptions: () => undefined,
          goToDiff: () => undefined,
          saveViewState: () => ({ scrollTop: ++saved }),
          restoreViewState: (s: unknown) => restored.push(s),
        };
      },
    },
  };
  const editors: ReturnType<typeof editor>[] = [];
  const created = monaco.editor.createDiffEditor;
  const diffOptions: ({ theme?: string } | undefined)[] = [];
  monaco.editor.createDiffEditor = (
    host: HTMLElement,
    options?: { theme?: string },
  ) => {
    diffOptions.push(options);
    const d = created(host, options);
    editors.push(d.getOriginalEditor(), d.getModifiedEditor());
    return d;
  };
  return { monaco, restored, editors, diffOptions };
});
vi.mock('../../review/loadMonaco', () => ({
  loadMonaco: () => Promise.resolve(fake.monaco),
}));

beforeEach(() => {
  fake.restored.length = 0;
  fake.editors.length = 0;
  fake.diffOptions.length = 0;
  fake.monaco.editor.setTheme.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

const card = (
  <CommentCard
    comment={{
      id: 'c1',
      workspaceId: 'home',
      path: 'a.ts',
      side: 'after',
      startLine: 1,
      endLine: 1,
      snippet: 'b',
      contextBefore: '',
      contextAfter: '',
      text: 'Rename',
      status: 'open',
      createdAt: '2026-10-17T10:00:00.000Z',
      sentAt: null,
      resolvedAt: null,
    }}
    onEdit={() => undefined}
    onResolve={() => undefined}
    onReopen={() => undefined}
    onDelete={() => undefined}
  />
);

const props = {
  uriKey: 'home/a.ts',
  before: 'a\n',
  after: 'b\n',
  sideBySide: true,
  ignoreWhitespace: false,
  hideUnchanged: false,
};
const zone = (id: string, afterLine: number, node: DiffZone['node']) =>
  ({ id, side: 'after', afterLine, node }) as const;

describe('DiffView theme', () => {
  it('creates the diff in the scheme on screen and follows a switch', async () => {
    setTestColorScheme('light');
    render(<DiffView {...props} />);
    await vi.waitFor(() => expect(fake.diffOptions).toHaveLength(1));
    expect(fake.diffOptions[0]?.theme).toBe('shellie-light');
    act(() => setTestColorScheme('dark'));
    expect(fake.monaco.editor.setTheme).toHaveBeenLastCalledWith(
      'shellie-dark',
    );
    expect(fake.diffOptions).toHaveLength(1);
  });
});

describe('DiffView zones', () => {
  it('draws a card over its view zone, not in it, inside the visible code area (#71)', async () => {
    render(<DiffView {...props} zones={[zone('c1', 1, card)]} />);
    const button = await screen.findByRole('button', { name: 'Edit' });
    const after = fake.editors[1];
    const [z] = [...after.zones.values()];
    // The zone, under Monaco's text layer, only keeps the space open.
    expect(z.domNode.contains(button)).toBe(false);
    const [widget] = [...after.widgets];
    expect(widget.contains(button)).toBe(true);
    expect(widget.style.left).toBe('60px');
    expect(widget.style.width).toBe('526px');
    act(() => z.onDomNodeTop?.(120));
    expect(widget.style.top).toBe('120px');
  });

  it('keeps a comment being edited, with its text, when the zones are rebuilt around it', async () => {
    const { rerender } = render(
      <DiffView {...props} zones={[zone('c1', 1, card)]} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const input = screen.getByRole('textbox', {
      name: 'Comment',
    }) as HTMLTextAreaElement;
    await userEvent.type(input, ' it');
    // Another comment arrives and this one moves: every Monaco view zone is made again.
    rerender(
      <DiffView
        {...props}
        zones={[zone('c1', 2, card), zone('c2', 5, <span>other</span>)]}
      />,
    );
    await screen.findByText('other');
    expect(screen.getByRole('textbox', { name: 'Comment' })).toBe(input);
    expect(input.value).toBe('Rename it');
    // A zone whose id is gone is dropped, its card too.
    rerender(
      <DiffView {...props} zones={[zone('c2', 5, <span>other</span>)]} />,
    );
    await act(async () => undefined);
    expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull();
    expect(screen.getByText('other')).toBeTruthy();
  });
});

describe('DiffView view state', () => {
  it('saves the view of a file when it is left and restores it when the file is shown again', async () => {
    const views = new Map<string, unknown>();
    const first = render(<DiffView {...props} viewStates={views} />);
    await act(async () => undefined);
    expect(fake.restored).toEqual([]);
    first.unmount();
    const saved = views.get('home/a.ts');
    expect(saved).toBeTruthy();
    const second = render(<DiffView {...props} viewStates={views} />);
    await act(async () => undefined);
    expect(fake.restored).toEqual([saved]);
    // Another file: the first one's view is kept for later, the new file has none yet.
    second.rerender(
      <DiffView {...props} uriKey="home/b.ts" viewStates={views} />,
    );
    await act(async () => undefined);
    expect(fake.restored).toEqual([saved]);
    expect(views.get('home/a.ts')).not.toBe(saved);
  });
});
