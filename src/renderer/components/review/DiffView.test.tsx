// src/renderer/components/review/DiffView.test.tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentCard } from './CommentCard';
import { DiffView, type DiffZone } from './DiffView';

// Monaco does not run in jsdom: a stand-in with just what DiffView calls. View zones are real DOM
// nodes in a host per editor, added and removed like Monaco does.
const fake = vi.hoisted(() => {
  const disp = { dispose: () => undefined };
  const restored: unknown[] = [];
  let saved = 0;
  const editor = () => {
    const host = document.createElement('div');
    let seq = 0;
    const zones = new Map<string, { domNode: HTMLElement }>();
    return {
      host,
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
          addZone: (z: { domNode: HTMLElement }) => string;
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
      createDiffEditor: (host: HTMLElement) => {
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
  return { monaco, restored };
});
vi.mock('../../review/loadMonaco', () => ({
  loadMonaco: () => Promise.resolve(fake.monaco),
}));

beforeEach(() => {
  fake.restored.length = 0;
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

describe('DiffView zones', () => {
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
    // A zone whose id is gone is dropped.
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
