import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ReviewFileStatus,
  ReviewFiles,
  ReviewState,
} from '../../../shared/review';
import type { TaskView } from '../../../shared/types';
import { useStore } from '../../store';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { ChangesTab } from './ChangesTab';

// Monaco does not run in jsdom: a stand-in that shows what it was given and renders the zones inline.
vi.mock('./DiffView', () => ({
  DiffView: (p: {
    uriKey: string;
    before: string;
    after: string;
    zones?: { id: string; node: unknown }[];
  }) => (
    <div data-testid="diff" data-key={p.uriKey}>
      <pre data-testid="before">{p.before}</pre>
      <pre data-testid="after">{p.after}</pre>
      {(p.zones ?? []).map((z) => (
        <div key={z.id} data-testid={`zone-${z.id}`}>
          {z.node as never}
        </div>
      ))}
    </div>
  ),
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
  useStore.setState({ repos: [], tabByTask: {} });
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

function mount(over = {}) {
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
  render(<ChangesTab task={task} />);
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
