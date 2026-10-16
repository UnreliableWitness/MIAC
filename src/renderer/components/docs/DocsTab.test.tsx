import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskView } from '../../../shared/types';
import { useStore } from '../../store';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { DocsTab, resetDocTargetsForTests } from './DocsTab';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg/>' })),
  },
}));

const task = {
  id: 't1',
  status: 'ready',
  terminals: [],
  worktreeMissing: false,
} as unknown as TaskView;
const files = [
  { path: '.miac/task.md', changed: null },
  { path: 'README.md', changed: null },
  { path: 'docs/plan.md', changed: 'new' as const },
];
let texts: Record<string, string>;
beforeEach(() => {
  localStorage.clear();
  resetDocTargetsForTests();
  texts = {
    '.miac/task.md': '# Task file',
    'README.md': '# Readme',
    'docs/plan.md': '# Plan\n\nline 3\n',
  };
  useStore.setState({ docTarget: {} });
});
const mount = (over = {}) => {
  const api = installFakeApi({
    'docs:list': () => ({ files }),
    'docs:read': (_t, p) => {
      if (!(p in texts)) throw new Error('Not found');
      return { text: texts[p], mtimeMs: 1 };
    },
    'docs:openInEditor': () => undefined,
    'docs:reveal': () => undefined,
    ...over,
  });
  const view = render(<DocsTab task={task} />);
  return Object.assign(api, { view });
};

describe('DocsTab', () => {
  it('opens the task file by default and lists files grouped with badges', async () => {
    mount();
    expect(
      await screen.findByRole('heading', { name: 'Task file' }),
    ).toBeTruthy();
    expect(screen.getByText('docs')).toBeTruthy();
    expect(screen.getByText('new')).toBeTruthy();
  });
  it('shows the empty state', async () => {
    mount({ 'docs:list': () => ({ files: [] }) });
    expect(
      await screen.findByText('No Markdown files in this worktree'),
    ).toBeTruthy();
  });
  it('filters the list', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Task file' });
    await userEvent.type(screen.getByPlaceholderText('Filter'), 'plan');
    expect(screen.queryByRole('button', { name: /README\.md/ })).toBeNull();
    expect(screen.getByRole('button', { name: /plan\.md/ })).toBeTruthy();
  });
  it('switches to Source and remembers file and view', async () => {
    mount();
    await userEvent.click(
      await screen.findByRole('button', { name: /plan\.md/ }),
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Source' }));
    expect(document.querySelectorAll('.src-line')).toHaveLength(3);
    expect(
      JSON.parse(localStorage.getItem('miac.docs.t1') ?? '{}'),
    ).toMatchObject({ path: 'docs/plan.md', view: 'source' });
  });
  it('reloads on docs:changed and shows the deleted bar when the file goes', async () => {
    const api = mount();
    await screen.findByRole('heading', { name: 'Task file' });
    texts['.miac/task.md'] = '# Task file v2';
    act(() =>
      api.emit('docs:changed', { taskId: 't1', paths: ['.miac/task.md'] }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Task file v2' }),
    ).toBeTruthy();
    delete texts['.miac/task.md'];
    act(() =>
      api.emit('docs:changed', { taskId: 't1', paths: ['.miac/task.md'] }),
    );
    expect(await screen.findByText('This file was deleted.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Task file v2' })).toBeTruthy();
  });
  it('shows the too-large state with Open in VS Code', async () => {
    mount({
      'docs:read': () => {
        throw new Error('Too large');
      },
    });
    expect(
      await screen.findByText('This file is larger than 2 MB.'),
    ).toBeTruthy();
  });
  it('opens a target set by openDoc in Source view at its line', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Task file' });
    act(() =>
      useStore.setState({
        docTarget: { t1: { path: 'docs/plan.md', line: 3, nonce: 1 } },
      }),
    );
    await waitFor(() =>
      expect(
        document.querySelector('.src-line.is-hl')?.getAttribute('data-line'),
      ).toBe('3'),
    );
  });
  it('opens VS Code at the highlighted line', async () => {
    const api = mount();
    act(() =>
      useStore.setState({
        docTarget: { t1: { path: 'docs/plan.md', line: 3, nonce: 2 } },
      }),
    );
    await waitFor(() =>
      expect(document.querySelector('.src-line.is-hl')).not.toBeNull(),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Open in VS Code' }),
    );
    expect(
      api.calls.find((c) => c.channel === 'docs:openInEditor')?.args,
    ).toEqual(['t1', 'docs/plan.md', 3]);
  });
  it('pairs docs:watch on with off on unmount', async () => {
    const api = mount();
    await screen.findByRole('heading', { name: 'Task file' });
    api.view.unmount();
    const w = api.calls
      .filter((c) => c.channel === 'docs:watch')
      .map((c) => c.args[1]);
    expect(w.filter(Boolean).length).toBe(w.filter((x) => !x).length);
  });
  it('polls docs:read when the watcher is not live', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let mtime = 1;
      mount({
        'docs:watch': () => ({ live: false }),
        'docs:read': () => ({ text: texts['.miac/task.md'], mtimeMs: mtime }),
      });
      await screen.findByRole('heading', { name: 'Task file' });
      texts['.miac/task.md'] = '# Polled';
      mtime = 2;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(
        await screen.findByRole('heading', { name: 'Polled' }),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
  it('does not send docs:watch off when on was rejected', async () => {
    const api = mount({
      'docs:watch': () => {
        throw new Error('nope');
      },
    });
    await screen.findByRole('heading', { name: 'Task file' });
    api.view.unmount();
    await Promise.resolve();
    const w = api.calls.filter((c) => c.channel === 'docs:watch');
    expect(w.map((c) => c.args[1])).toEqual([true]);
  });
  it('never shows a polled file of the old path after switching files', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let release: () => void = () => undefined;
      let mode: 'normal' | 'held' | 'stale' = 'normal';
      mount({
        'docs:watch': () => ({ live: false }),
        'docs:read': async (_t: string, p: string) => {
          if (p === '.miac/task.md' && mode !== 'normal') {
            if (mode === 'held') await new Promise<void>((r) => (release = r));
            return { text: '# OLD STALE', mtimeMs: 9 };
          }
          return { text: texts[p], mtimeMs: 1 };
        },
      });
      await screen.findByRole('heading', { name: 'Task file' });
      mode = 'held';
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      await userEvent.click(screen.getByRole('button', { name: /README\.md/ }));
      expect(
        await screen.findByRole('heading', { name: 'Readme' }),
      ).toBeTruthy();
      await act(async () => {
        mode = 'stale';
        release();
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(screen.queryByText('OLD STALE')).toBeNull();
      expect(screen.getByRole('heading', { name: 'Readme' })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
