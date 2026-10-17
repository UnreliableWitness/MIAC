import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ReviewFileStatus,
  ReviewFiles,
  ReviewState,
} from '../../../shared/review';
import type { TaskView } from '../../../shared/types';
import { useStore } from '../../store';
import { type FakeHandlers, installFakeApi } from '../../test-helpers/fakeApi';
import { ChangesTab } from './ChangesTab';

// Monaco does not run in jsdom: a stand-in that shows what it was given and renders the zones inline.
// A change in the zones' ids or lines remounts every zone's content here, the worst case: the real
// view keeps each zone's node across rebuilds (DiffView.test.tsx), and the draft must survive either way.
// Every reveal the view carries out, like the real one: on a new seq or a new file.
const reveals = vi.hoisted(() => [] as { path: string; line: number }[]);
vi.mock('./DiffView', () => ({
  DiffView: (p: {
    uriKey: string;
    before: string;
    after: string;
    zones?: { id: string; afterLine: number; node: unknown }[];
    onGlyph?: (side: 'before' | 'after', line: number) => void;
    reveal?: { side: 'before' | 'after'; line: number; seq: number };
    onRevealed?: () => void;
  }) => {
    useEffect(() => {
      if (!p.reveal) return;
      reveals.push({ path: p.uriKey, line: p.reveal.line });
      p.onRevealed?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [p.reveal?.seq, p.uriKey]);
    const sig = (p.zones ?? []).map((z) => `${z.id}@${z.afterLine}`).join(',');
    return (
      <div data-testid="diff" data-key={p.uriKey}>
        <pre data-testid="before">{p.before}</pre>
        <pre data-testid="after">{p.after}</pre>
        {p.onGlyph && (
          <button type="button" onClick={() => p.onGlyph?.('after', 2)}>
            add on line 2
          </button>
        )}
        {p.onGlyph && (
          <button type="button" onClick={() => p.onGlyph?.('before', 3)}>
            add on base line 3
          </button>
        )}
        {(p.zones ?? []).map((z) => (
          <div key={`${z.id}|${sig}`} data-testid={`zone-${z.id}`}>
            {z.node as never}
          </div>
        ))}
      </div>
    );
  },
}));

const task = {
  id: 't1',
  repoId: 'r1',
  status: 'ready',
  branch: 'task',
  worktreePath: '/wt',
  terminals: [{ id: 'c1', kind: 'claude', label: 'Claude Code' }],
  worktreeMissing: false,
  extraWorkspaces: [],
  homeDropped: false,
} as unknown as TaskView;

const file = (path: string, hash: string, status: ReviewFileStatus = 'M') =>
  ({ path, status, added: 1, removed: 1, binary: false, hash }) as const;
let files: ReviewFiles;
let state: ReviewState;

beforeEach(() => {
  localStorage.clear();
  reveals.length = 0;
  useStore.setState({ repos: [], tabByTask: {}, reviewByTask: {} });
  files = {
    repos: [
      {
        workspaceId: 'home',
        name: 'web',
        base: 'b'.repeat(40),
        commits: [
          {
            sha: 'c'.repeat(40),
            subject: 'second',
            author: 'Dev',
            date: '2026-10-17T09:00:00Z',
          },
          {
            sha: 'd'.repeat(40),
            subject: 'first',
            author: 'Dev',
            date: '2026-10-17T08:00:00Z',
          },
        ],
        collapse: [],
        files: [
          file('src/a.ts', 'h1'),
          file('package-lock.json', 'h2'),
          file('src/b.ts', 'h3', 'A'),
        ],
      },
    ],
  };
  state = { version: 1, viewed: {}, comments: [] };
});

function mount(over: FakeHandlers = {}) {
  const api = installApi(over);
  render(<ChangesTab task={task} />);
  return api;
}

function installApi(over: FakeHandlers = {}) {
  const api = installFakeApi({
    'review:files': () => files,
    'review:state': () => state,
    'review:file': (_t, _w, f) => ({
      before: `old ${f.path}`,
      after: `new ${f.path}`,
      binary: false,
      tooLarge: false,
      beforeSize: 1,
      afterSize: 1,
    }),
    'review:setViewed': (_t, key, hash) => {
      state = { ...state, viewed: { ...state.viewed } };
      if (hash) state.viewed[key] = hash;
      else delete state.viewed[key];
      return state;
    },
    ...over,
  });
  return api;
}

describe('ChangesTab', () => {
  it('lists files with generated ones collapsed, and opens the first file', async () => {
    mount();
    const tree = await screen.findByRole('tree', { name: 'Changed files' });
    expect(within(tree).getByText('a.ts')).toBeTruthy();
    expect(within(tree).getByText('b.ts')).toBeTruthy();
    expect(within(tree).getByText('Generated (1)')).toBeTruthy();
    expect(within(tree).queryByText('package-lock.json')).toBeNull();
    expect((await screen.findByTestId('after')).textContent).toBe(
      'new src/a.ts',
    );
    expect(screen.getByText('0 / 3 viewed')).toBeTruthy();
  });

  it('marks a file viewed, and shows it changed since when its hash moves', async () => {
    const api = mount();
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Viewed src/a.ts' }),
    );
    await screen.findByText('1 / 3 viewed');
    expect(
      api.calls.find((c) => c.channel === 'review:setViewed')?.args,
    ).toEqual(['t1', 'home:src/a.ts', 'h1']);
    files = {
      repos: [
        {
          ...files.repos[0],
          files: [file('src/a.ts', 'h9'), ...files.repos[0].files.slice(1)],
        },
      ],
    };
    act(() => api.emit('review:changed', { taskId: 't1' }));
    await screen.findByText('Changed since viewed');
    expect(screen.getByText('0 / 3 viewed')).toBeTruthy();
  });

  it('shows another file when clicked, and reloads the open file on a change', async () => {
    const api = mount();
    fireEvent.click(await screen.findByText('b.ts'));
    await waitFor(() =>
      expect(screen.getByTestId('after').textContent).toBe('new src/b.ts'),
    );
    const reads = () =>
      api.calls.filter((c) => c.channel === 'review:file').length;
    const before = reads();
    act(() => api.emit('docs:changed', { taskId: 't1', paths: ['src/b.ts'] }));
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });

  it('switches to Uncommitted and to one commit', async () => {
    const api = mount();
    await screen.findByRole('tree', { name: 'Changed files' });
    fireEvent.click(screen.getByRole('button', { name: 'Uncommitted' }));
    await waitFor(() =>
      expect(
        api.calls.some(
          (c) =>
            c.channel === 'review:files' &&
            (c.args[1] as { kind: string }).kind === 'uncommitted',
        ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Commits' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /first/ }));
    await waitFor(() =>
      expect(
        api.calls.some(
          (c) =>
            c.channel === 'review:files' &&
            (c.args[1] as { kind: string; from?: string }).from ===
              'd'.repeat(40),
        ),
      ).toBe(true),
    );
    expect(screen.getByText('Comments are shown in All changes')).toBeTruthy();
  });

  it('shows a repo error and the no-base message without losing other repos', async () => {
    files = {
      repos: [
        {
          ...files.repos[0],
          error: 'No base for this task: only uncommitted changes can be shown',
          files: [],
        },
        {
          workspaceId: 'w2',
          name: 'api',
          base: null,
          commits: [],
          collapse: [],
          files: [file('x.cs', 'h4')],
        },
      ],
    };
    mount();
    expect(
      await screen.findByText(
        'No base for this task: only uncommitted changes can be shown',
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('tree', { name: 'Changed files' })).getByText(
        'x.cs',
      ),
    ).toBeTruthy();
  });

  it('says so when nothing changed', async () => {
    files = { repos: [{ ...files.repos[0], files: [] }] };
    mount();
    expect(
      await screen.findByText('No changes since the task started.'),
    ).toBeTruthy();
  });

  it('shows sizes instead of a diff for a binary file', async () => {
    files = {
      repos: [
        {
          ...files.repos[0],
          files: [{ ...file('logo.png', 'h5'), binary: true }],
        },
      ],
    };
    mount({
      'review:file': () => ({
        before: null,
        after: null,
        binary: true,
        tooLarge: false,
        beforeSize: 1200,
        afterSize: 3482,
      }),
    });
    expect(
      await screen.findByText('Binary file, 1.2 KB → 3.4 KB'),
    ).toBeTruthy();
  });
});

describe('ChangesTab while a file loads', () => {
  it('does not show the previous file under the new name', async () => {
    let answer: () => void = () => {};
    mount({
      'review:file': (_t: string, _w: string, f: { path: string }) => {
        const c = {
          before: `old ${f.path}`,
          after: `new ${f.path}`,
          binary: false,
          tooLarge: false,
          beforeSize: 1,
          afterSize: 1,
        };
        return f.path === 'src/b.ts'
          ? new Promise((r) => (answer = () => r(c)))
          : c;
      },
    });
    expect((await screen.findByTestId('after')).textContent).toBe(
      'new src/a.ts',
    );
    fireEvent.click(screen.getByText('b.ts'));
    await screen.findByText('Loading src/b.ts…');
    expect(screen.queryByTestId('diff')).toBeNull();
    await act(async () => answer());
    expect((await screen.findByTestId('after')).textContent).toBe(
      'new src/b.ts',
    );
  });
});

const comment = (over: Partial<ReviewState['comments'][number]> = {}) => ({
  id: 'c1',
  workspaceId: 'home',
  path: 'src/a.ts',
  side: 'after' as const,
  startLine: 2,
  endLine: 2,
  snippet: 'x',
  contextBefore: '',
  contextAfter: '',
  text: 'Please rename',
  status: 'open' as const,
  createdAt: '2026-10-17T10:00:00.000Z',
  sentAt: null,
  resolvedAt: null,
  ...over,
});

describe('ChangesTab comments', () => {
  it('adds a comment from the gutter', async () => {
    const api = mount({
      'review:addComment': (_t, input) =>
        (state = { ...state, comments: [comment({ text: input.text })] }),
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'add on line 2' }),
    );
    await userEvent.type(
      within(screen.getByTestId('zone-draft')).getByRole('textbox', {
        name: 'Comment',
      }),
      'Rename this',
    );
    fireEvent.click(
      within(screen.getByTestId('zone-draft')).getByRole('button', {
        name: 'Comment',
      }),
    );
    await screen.findByTestId('zone-c1');
    expect(
      api.calls.find((c) => c.channel === 'review:addComment')?.args,
    ).toEqual([
      't1',
      {
        workspaceId: 'home',
        path: 'src/a.ts',
        side: 'after',
        startLine: 2,
        endLine: 2,
        text: 'Rename this',
      },
    ]);
    expect(screen.queryByTestId('zone-draft')).toBeNull();
    expect(screen.getByLabelText('1 comment')).toBeTruthy();
    expect(screen.getByText('1 open comment')).toBeTruthy();
  });

  it('keeps a draft across a refresh', async () => {
    const api = mount();
    fireEvent.click(
      await screen.findByRole('button', { name: 'add on line 2' }),
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Comment' }),
      'half a thought',
    );
    const reads = api.calls.filter((c) => c.channel === 'review:files').length;
    act(() => api.emit('review:changed', { taskId: 't1' }));
    await waitFor(() =>
      expect(
        api.calls.filter((c) => c.channel === 'review:files').length,
      ).toBeGreaterThan(reads),
    );
    expect(
      (screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement)
        .value,
    ).toBe('half a thought');
  });

  it('keeps a draft when the zones are rebuilt around it', async () => {
    const api = mount();
    fireEvent.click(
      await screen.findByRole('button', { name: 'add on line 2' }),
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Comment' }),
      'half a thought',
    );
    const draftBox = screen.getByRole('textbox', { name: 'Comment' });
    // Another comment on this file arrives: every zone is remounted.
    state = {
      ...state,
      comments: [
        comment({ id: 'c2', startLine: 5, endLine: 5, text: 'Other' }),
      ],
    };
    act(() => api.emit('review:changed', { taskId: 't1' }));
    await screen.findByTestId('zone-c2');
    const box = within(screen.getByTestId('zone-draft')).getByRole('textbox', {
      name: 'Comment',
    }) as HTMLTextAreaElement;
    expect(box).not.toBe(draftBox);
    expect(box.value).toBe('half a thought');
  });

  it('resolves a comment and counts it out', async () => {
    state = { ...state, comments: [comment()] };
    const api = mount({
      'review:updateComment': (_t, _id, patch) =>
        (state = {
          ...state,
          comments: [
            comment({
              status: patch.status === 'resolved' ? 'resolved' : 'open',
            }),
          ],
        }),
    });
    fireEvent.click(
      within(await screen.findByTestId('zone-c1')).getByRole('button', {
        name: 'Resolve',
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('zone-c1')).toBeNull());
    expect(
      api.calls.find((c) => c.channel === 'review:updateComment')?.args,
    ).toEqual(['t1', 'c1', { status: 'resolved' }]);
    expect(api.tracked).toContainEqual({
      type: 'event',
      name: 'review.commentResolved',
      props: { outdated: false },
    });
  });

  it('shows outdated comments of the file above the diff', async () => {
    state = {
      ...state,
      comments: [
        comment({ status: 'outdated', sentAt: '2026-10-17T10:05:00.000Z' }),
      ],
    };
    mount();
    expect(
      await screen.findByText('Code changed, probably addressed'),
    ).toBeTruthy();
  });

  it('lists all comments and opens one', async () => {
    state = {
      ...state,
      comments: [comment({ path: 'src/b.ts', text: 'On b' })],
    };
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Comments (1)' }));
    fireEvent.click(screen.getByRole('listitem'));
    await waitFor(() =>
      expect(screen.getByTestId('after').textContent).toBe('new src/b.ts'),
    );
  });

  it('reveals an opened comment once, not again on a later visit to its file', async () => {
    state = {
      ...state,
      comments: [
        comment({ path: 'src/b.ts', startLine: 7, endLine: 7, text: 'On b' }),
      ],
    };
    mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Comments (1)' }));
    fireEvent.click(screen.getByRole('listitem'));
    await waitFor(() =>
      expect(reveals).toEqual([{ path: 'home/src/b.ts', line: 7 }]),
    );
    fireEvent.click(screen.getByText('a.ts'));
    await waitFor(() =>
      expect(screen.getByTestId('after').textContent).toBe('new src/a.ts'),
    );
    fireEvent.click(screen.getByText('b.ts'));
    await waitFor(() =>
      expect(screen.getByTestId('after').textContent).toBe('new src/b.ts'),
    );
    expect(reveals).toHaveLength(1);
  });

  it('keeps a draft with text when + is clicked again, and moves an empty one', async () => {
    mount();
    const add = await screen.findByRole('button', { name: 'add on line 2' });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(screen.getAllByRole('textbox', { name: 'Comment' })).toHaveLength(1);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Comment' }),
      'keep me',
    );
    fireEvent.click(add);
    expect(
      (screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement)
        .value,
    ).toBe('keep me');
    expect(useStore.getState().notices.map((n) => n.message)).toContain(
      'Finish or cancel the open comment first',
    );
  });

  it('adds a comment once when it is submitted twice quickly', async () => {
    let answer: () => void = () => {};
    const api = mount({
      'review:addComment': (_t, input) =>
        new Promise((r) => {
          answer = () =>
            r(
              (state = { ...state, comments: [comment({ text: input.text })] }),
            );
        }),
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'add on line 2' }),
    );
    const box = screen.getByRole('textbox', { name: 'Comment' });
    await userEvent.type(box, 'Once');
    fireEvent.click(
      within(screen.getByTestId('zone-draft')).getByRole('button', {
        name: 'Comment',
      }),
    );
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(
      (
        within(screen.getByTestId('zone-draft')).getByRole('button', {
          name: 'Comment',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await act(async () => answer());
    await screen.findByTestId('zone-c1');
    expect(
      api.calls.filter((c) => c.channel === 'review:addComment'),
    ).toHaveLength(1);
  });

  it('offers no new comments outside All changes', async () => {
    mount();
    await screen.findByRole('button', { name: 'add on line 2' });
    fireEvent.click(screen.getByRole('button', { name: 'Uncommitted' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'add on line 2' }),
      ).toBeNull(),
    );
  });

  it('moves to the next file with j on the page', async () => {
    mount();
    await waitFor(() =>
      expect(screen.getByTestId('after').textContent).toBe('new src/a.ts'),
    );
    fireEvent.keyDown(screen.getByRole('region', { name: 'Changes' }), {
      key: 'j',
    });
    await waitFor(() =>
      expect(screen.getByTestId('after').textContent).toBe('new src/b.ts'),
    );
  });
});

describe('ChangesTab more', () => {
  it('resolves and deletes, from the Comments list, a comment on a file that is no longer listed', async () => {
    state = {
      ...state,
      comments: [
        comment({ id: 'gone', path: 'src/old.ts', status: 'outdated' }),
      ],
    };
    const api = mount({
      'review:updateComment': (_t, id, patch) =>
        (state = {
          ...state,
          comments: state.comments.map((c) =>
            c.id === id
              ? {
                  ...c,
                  status: patch.status === 'resolved' ? 'resolved' : 'open',
                }
              : c,
          ),
        }),
      'review:deleteComment': (_t, id) =>
        (state = {
          ...state,
          comments: state.comments.filter((c) => c.id !== id),
        }),
    });
    await screen.findByText('1 open comment');
    fireEvent.click(screen.getByRole('tab', { name: 'Comments (1)' }));
    const row = screen.getByRole('listitem');
    fireEvent.click(within(row).getByRole('button', { name: 'Resolve' }));
    await screen.findByText('0 open comments');
    expect(
      api.calls.find((c) => c.channel === 'review:updateComment')?.args,
    ).toEqual(['t1', 'gone', { status: 'resolved' }]);
    // The row stays on the Comments list (a click on an action does not open the file).
    expect(screen.getByRole('tab', { name: 'Comments (1)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.click(
      within(screen.getByRole('listitem')).getByRole('button', {
        name: 'Reopen',
      }),
    );
    await screen.findByText('1 open comment');
    fireEvent.click(
      within(screen.getByRole('listitem')).getByRole('button', {
        name: 'Delete',
      }),
    );
    await screen.findByRole('tab', { name: 'Comments (0)' });
    expect(
      api.calls.find((c) => c.channel === 'review:deleteComment')?.args,
    ).toEqual(['t1', 'gone']);
  });

  it('keeps the scope, the selected file and the draft when the tab is left and opened again', async () => {
    installApi();
    const first = render(<ChangesTab task={task} />);
    fireEvent.click(await screen.findByText('b.ts'));
    await waitFor(() =>
      expect(screen.getByTestId('after').textContent).toBe('new src/b.ts'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'add on line 2' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Comment' }),
      'half a thought',
    );
    first.unmount();
    render(<ChangesTab task={task} />);
    await waitFor(() =>
      expect(screen.getByTestId('after').textContent).toBe('new src/b.ts'),
    );
    expect(
      (screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement)
        .value,
    ).toBe('half a thought');
  });

  it('keeps the scope across a remount, and falls back to the first file when the stored one is gone', async () => {
    const api = installApi();
    const first = render(<ChangesTab task={task} />);
    fireEvent.click(await screen.findByText('b.ts'));
    fireEvent.click(screen.getByRole('button', { name: 'Uncommitted' }));
    await waitFor(() =>
      expect(
        api.calls.some(
          (c) =>
            c.channel === 'review:files' &&
            (c.args[1] as { kind: string }).kind === 'uncommitted',
        ),
      ).toBe(true),
    );
    first.unmount();
    files = {
      repos: [{ ...files.repos[0], files: [file('src/a.ts', 'h1')] }],
    };
    const n = api.calls.length;
    render(<ChangesTab task={task} />);
    await waitFor(() =>
      expect(screen.getByTestId('after').textContent).toBe('new src/a.ts'),
    );
    const again = api.calls
      .slice(n)
      .filter((c) => c.channel === 'review:files');
    expect(again.length).toBeGreaterThan(0);
    expect(
      again.every(
        (c) => (c.args[1] as { kind: string }).kind === 'uncommitted',
      ),
    ).toBe(true);
  });

  it('comments on the base side of a renamed file with its old path', async () => {
    files = {
      repos: [
        {
          ...files.repos[0],
          files: [{ ...file('src/new.ts', 'h1', 'R'), oldPath: 'src/old.ts' }],
        },
      ],
    };
    const api = mount({
      'review:addComment': (_t, input) =>
        (state = {
          ...state,
          comments: [comment({ ...input, path: input.path })],
        }),
    });
    fireEvent.click(
      await screen.findByRole('button', { name: 'add on base line 3' }),
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Comment' }),
      'Why removed?',
    );
    fireEvent.click(
      within(screen.getByTestId('zone-draft')).getByRole('button', {
        name: 'Comment',
      }),
    );
    await waitFor(() =>
      expect(
        api.calls.find((c) => c.channel === 'review:addComment')?.args,
      ).toEqual([
        't1',
        {
          workspaceId: 'home',
          path: 'src/new.ts',
          oldPath: 'src/old.ts',
          side: 'before',
          startLine: 3,
          endLine: 3,
          text: 'Why removed?',
        },
      ]),
    );
  });

  it('shows why the changes could not be loaded instead of loading forever', async () => {
    mount({
      'review:files': () => {
        throw new Error(
          "Error invoking remote method 'review:files': Error: The task is not ready (finishing)",
        );
      },
    });
    expect(
      await screen.findByText(
        'The changes could not be loaded: The task is not ready (finishing)',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Loading changes…')).toBeNull();
  });
});

describe('ChangesTab file tree', () => {
  beforeEach(() => {
    files = {
      ...files,
      repos: [
        {
          ...files.repos[0],
          files: [
            file('z.md', 'h1'),
            file('src/b.ts', 'h2'),
            file('src/a.ts', 'h3'),
          ],
        },
      ],
    };
  });
  const after = async (text: string) =>
    waitFor(() => expect(screen.getByTestId('after').textContent).toBe(text));

  it('walks next file in the order the tree shows', async () => {
    mount();
    await after('new src/a.ts');
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }));
    await after('new src/b.ts');
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }));
    await after('new z.md');
  });

  it('walks the list order once switched to list, and keeps that choice', async () => {
    mount();
    await after('new src/a.ts');
    fireEvent.click(screen.getByRole('button', { name: 'Show as list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }));
    // List order is the order git gave: z.md, src/b.ts, src/a.ts; from the last it wraps.
    await after('new z.md');
    expect(
      JSON.parse(localStorage.getItem('miac.review.prefs') ?? '{}').fileView,
    ).toBe('list');
  });

  it('unfolds the folder of a file that is opened inside it', async () => {
    mount();
    await after('new src/a.ts');
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }));
    await after('new z.md');
    fireEvent.click(screen.getByText('src'));
    expect(screen.queryByText('a.ts')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }));
    await after('new src/a.ts');
    expect(screen.getByText('a.ts')).toBeTruthy();
  });

  it('keeps folded folders per task across a remount', async () => {
    mount();
    await after('new src/a.ts');
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }));
    await after('new z.md');
    fireEvent.click(screen.getByText('src'));
    cleanup();
    mount();
    await after('new z.md');
    expect(screen.queryByText('a.ts')).toBeNull();
  });
});
