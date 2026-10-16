import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskView } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { Shell } from '../App';

const mounts = vi.hoisted(() => ({ count: 0 }));

vi.mock('../components/TerminalView', async () => {
  const { useEffect } = await import('react');
  return {
    TerminalView: ({
      terminalId,
      active,
    }: {
      terminalId: string;
      active: boolean;
    }) => {
      useEffect(() => {
        mounts.count++;
      }, []);
      return <div data-testid={`term-${terminalId}`} data-active={active} />;
    },
  };
});

const AHEAD_CHANGED = new RegExp(
  `${String.fromCharCode(0x2191)}2 ${String.fromCharCode(0xb7)} 3${String.fromCharCode(0x394)}`,
);

const task: TaskView = {
  id: 'a',
  repoId: 'r1',
  name: '',
  workItem: {
    id: '48213',
    type: 'User Story',
    title: 'Checkout: allow saving a delivery address',
    url: null,
  },
  slug: 'a',
  branch: 'feature/48213-save-delivery-address',
  worktreePath: '/src/webshop.worktrees/48213-save-delivery-address',
  baseRef: 'origin/main',
  baseSha: null,
  status: 'ready',
  setup: {
    copy: true,
    commands: [],
    startClaude: true,
    openShell: true,
    openCopilot: false,
  },
  terminals: [
    { id: 'c1', kind: 'claude', label: 'Claude Code' },
    { id: 's1', kind: 'shell', label: 'zsh' },
  ],
  createdAt: 'now',
  finishedAt: null,
  usageSyncedAt: null,
  usageSyncError: null,
  usageCommentId: null,
  summary: null,
  pullRequest: null,
  worktreeMissing: false,
};
const config = {
  worktreeRoot: '/src/webshop.worktrees',
  config: {
    base: 'main',
    branch: '{type}/{id}-{slug}',
    copy: [],
    setup: [],
    run: { dev: 'npm run dev', test: 'npm test' },
    found: true,
  },
};

beforeEach(() =>
  useStore.setState({
    repos: [
      {
        id: 'r1',
        name: 'webshop',
        path: '/src/webshop',
        baseBranch: 'main',
        connectionId: null,
        miacYmlFound: true,
        workItemOnStart: {
          moveToInProgress: true,
          assignToMe: true,
          stateOverrides: {},
        },
      },
    ],
    tasks: [task],
    connections: [],
    notices: [],
    screen: { kind: 'task' },
    previous: null,
    connectionId: null,
    selectedTaskId: 'a',
  }),
);

describe('TaskScreen', () => {
  it('shows the task in the breadcrumb, git state and the terminal tabs', async () => {
    installFakeApi({
      'repos:config': () => config,
      'tasks:gitSummary': () => ({
        branch: 'feature/48213-save-delivery-address',
        ahead: 2,
        behind: 0,
        hasUpstream: true,
        files: [
          { status: 'M', path: 'a' },
          { status: 'M', path: 'b' },
          { status: '?', path: 'c' },
        ],
      }),
    });
    render(<Shell />);
    expect(
      within(screen.getByRole('banner')).getByText(
        'User Story 48213 Checkout: allow saving a delivery address',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText(AHEAD_CHANGED)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Claude Code/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('term-c1')).toHaveAttribute(
      'data-active',
      'true',
    );
    expect(screen.getByTestId('term-s1')).toHaveAttribute(
      'data-active',
      'false',
    );
    await userEvent.click(screen.getByRole('tab', { name: /zsh/ }));
    expect(screen.getByTestId('term-s1')).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  it('opens run commands from .miac.yml as new terminals', async () => {
    const { calls } = installFakeApi({
      'repos:config': () => config,
      'tasks:gitSummary': () => ({
        branch: 'x',
        ahead: 0,
        behind: 0,
        hasUpstream: false,
        files: [],
      }),
      'terminals:open': () => ({
        id: 'n1',
        kind: 'run',
        label: 'dev',
        command: 'npm run dev',
      }),
    });
    render(<Shell />);
    await userEvent.click(await screen.findByRole('button', { name: 'dev' }));
    await waitFor(() =>
      expect(calls.find((c) => c.channel === 'terminals:open')?.args).toEqual([
        'a',
        { kind: 'run', label: 'dev', command: 'npm run dev' },
      ]),
    );
  });

  it('opens a Copilot CLI terminal from the tab bar', async () => {
    const { calls } = installFakeApi({
      'repos:config': () => config,
      'tasks:gitSummary': () => ({
        branch: 'x',
        ahead: 0,
        behind: 0,
        hasUpstream: false,
        files: [],
      }),
      'terminals:open': () => ({
        id: 'n2',
        kind: 'copilot',
        label: 'Copilot CLI',
      }),
    });
    render(<Shell />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Copilot CLI' }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.channel === 'terminals:open')?.args).toEqual([
        'a',
        { kind: 'copilot', label: 'Copilot CLI' },
      ]),
    );
  });

  it('opens the editor and the Finish page from the task row', async () => {
    const { calls } = installFakeApi({
      'repos:config': () => config,
      'tasks:gitSummary': () => ({
        branch: 'x',
        ahead: 0,
        behind: 0,
        hasUpstream: false,
        files: [],
      }),
      'tasks:openInEditor': () => undefined,
    });
    render(<Shell />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Open in VS Code' }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'tasks:openInEditor')).toBe(true),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Finish task' }));
    expect(useStore.getState().screen).toEqual({ kind: 'finish', taskId: 'a' });
  });

  it('shows a Done page with a header, a local finish time and the usage panel', async () => {
    const url =
      'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/48213';
    const { calls } = installFakeApi({
      'shell:openExternal': () => undefined,
    });
    const finishedAt = new Date(2026, 9, 14, 12, 0).toISOString();
    useStore.setState({
      tasks: [
        {
          ...task,
          workItem: { ...task.workItem!, url },
          status: 'done',
          terminals: [],
          finishedAt,
        },
      ],
    });
    render(<Shell />);
    const main = screen.getByRole('main');
    expect(
      within(main).getByRole('heading', {
        level: 1,
        name: 'Checkout: allow saving a delivery address',
      }),
    ).toBeInTheDocument();
    expect(within(main).getByText('14 Oct 2026, 12:00')).toBeInTheDocument();
    expect(main).not.toHaveTextContent(finishedAt);
    await userEvent.click(
      within(main).getByRole('button', {
        name: 'Open User Story 48213 in Azure DevOps',
      }),
    );
    expect(calls.find((c) => c.channel === 'shell:openExternal')?.args).toEqual(
      [url],
    );
    expect(
      await screen.findByRole('region', { name: 'AI usage' }),
    ).toBeInTheDocument();
    expect(useStore.getState().activeTab('a')).toBe('usage');
  });

  it('shows an empty state without a selected task', () => {
    installFakeApi();
    useStore.setState({ tasks: [], selectedTaskId: null });
    render(<Shell />);
    expect(
      screen.getByRole('heading', { name: 'No task selected' }),
    ).toBeInTheDocument();
  });

  it('shows the other task when the selection changes', async () => {
    installFakeApi({
      'repos:config': () => config,
      'tasks:gitSummary': () => ({
        branch: 'x',
        ahead: 0,
        behind: 0,
        hasUpstream: false,
        files: [],
      }),
    });
    const second: TaskView = {
      ...task,
      id: 'b',
      workItem: { id: '2', type: 'Bug', title: 'Second task', url: null },
      terminals: [{ id: 'c2', kind: 'claude', label: 'Claude Code' }],
    };
    useStore.setState({ tasks: [task, second] });
    render(<Shell />);
    expect(screen.getByTestId('term-c1')).toBeInTheDocument();
    act(() => useStore.setState({ selectedTaskId: 'b' }));
    expect(
      within(screen.getByRole('banner')).getByText('Bug 2 Second task'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('term-c2')).toHaveAttribute(
      'data-active',
      'true',
    );
    // The other task's terminals stay mounted but inactive, so switching back does not replay them.
    expect(screen.getByTestId('term-c1')).toHaveAttribute(
      'data-active',
      'false',
    );
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Claude Code/ })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
  });

  it('shows the cost in the task row and opens the Usage tab from it', async () => {
    installFakeApi({
      'repos:config': () => config,
      'tasks:gitSummary': () => ({
        branch: 'x',
        ahead: 0,
        behind: 0,
        hasUpstream: false,
        files: [],
      }),
      'usage:task': (id) => ({
        taskId: id,
        sessions: [],
        recent: [],
        unpricedRequests: 0,
        usdToEur: 0.92,
        billable: { costUsd: 25, costEur: 23, tokens: 1 },
        byTool: {
          'claude-code': { costUsd: 25, costEur: 23, sessions: 1, tokens: 1 },
          'copilot-cli': { costUsd: 0, costEur: 0, sessions: 0, tokens: 0 },
        },
      }),
    });
    render(<Shell />);
    await userEvent.click(
      await screen.findByRole('button', { name: /AI cost .*23\.00/ }),
    );
    expect(useStore.getState().activeTab('a')).toBe('usage');
    expect(screen.getByRole('region', { name: 'AI usage' })).toBeVisible();
  });

  it('disables Open in VS Code when the worktree is missing and hides Finish unless ready', async () => {
    installFakeApi({
      'repos:config': () => config,
      'tasks:gitSummary': () => ({
        branch: 'x',
        ahead: 0,
        behind: 0,
        hasUpstream: false,
        files: [],
      }),
    });
    useStore.setState({ tasks: [{ ...task, worktreeMissing: true }] });
    const { unmount } = render(<Shell />);
    expect(
      screen.getByRole('button', { name: 'Open in VS Code' }),
    ).toBeDisabled();
    unmount();
    useStore.setState({ tasks: [{ ...task, status: 'finishing' }] });
    render(<Shell />);
    expect(screen.queryByRole('button', { name: 'Finish task' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Open in VS Code' }),
    ).toBeNull();
  });

  it('shows an Open setup panel instead of the terminals for a setup-failed task', async () => {
    installFakeApi();
    useStore.setState({ tasks: [{ ...task, status: 'setup-failed' }] });
    render(<Shell />);
    expect(screen.getByText('Setup failed for this task.')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open setup' }));
    expect(useStore.getState().screen).toEqual({
      kind: 'setup',
      taskId: 'a',
    });
  });
});

function setup(over: Partial<TaskView> = {}) {
  const { emit } = installFakeApi({
    'repos:config': () => config,
    'tasks:gitSummary': () => ({
      branch: 'x',
      ahead: 0,
      behind: 0,
      hasUpstream: false,
      files: [],
    }),
  });
  useStore.setState({
    tasks: [{ ...task, ...over }],
    selectedTaskId: 'a',
  });
  return { emit };
}

const FOCUS_KEYS = {
  key: 'F',
  code: 'KeyF',
  shiftKey: true,
  ctrlKey: true,
  metaKey: true,
};

describe('tabs and focus', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ focus: false, navCollapsed: false, tabByTask: {} });
  });

  it('pins Usage first, before the terminals', async () => {
    setup();
    render(<Shell />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      expect.stringContaining('Usage'),
      expect.stringContaining('Docs'),
      'Claude Code',
      'zsh',
    ]);
  });

  it('switches with Mod+0 and Mod+2 even when the key comes from inside the terminal', async () => {
    setup();
    render(<Shell />);
    const term = await screen.findByTestId('term-c1');
    const ev = createEvent.keyDown(term, {
      key: '0',
      code: 'Digit0',
      ctrlKey: true,
      metaKey: true,
    });
    fireEvent(term, ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByRole('region', { name: 'AI usage' })).toBeVisible();
    fireEvent.keyDown(term, {
      key: '2',
      code: 'Digit2',
      ctrlKey: true,
      metaKey: true,
    });
    expect(screen.getByTestId('term-s1')).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  it('switches by physical key on AZERTY layouts (Mod+à is Digit0, Mod+é is Digit2)', async () => {
    setup();
    render(<Shell />);
    const term = await screen.findByTestId('term-c1');
    const ev = createEvent.keyDown(term, {
      key: '\u00e0',
      code: 'Digit0',
      ctrlKey: true,
      metaKey: true,
    });
    fireEvent(term, ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByRole('region', { name: 'AI usage' })).toBeVisible();
    fireEvent.keyDown(term, {
      key: '\u00e9',
      code: 'Digit2',
      ctrlKey: true,
      metaKey: true,
    });
    expect(screen.getByTestId('term-s1')).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  it('switches with the numpad digits', async () => {
    setup();
    render(<Shell />);
    const term = await screen.findByTestId('term-c1');
    fireEvent.keyDown(term, {
      key: '2',
      code: 'Numpad2',
      ctrlKey: true,
      metaKey: true,
    });
    expect(screen.getByTestId('term-s1')).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  it('does not treat a digit character on another physical key as a tab shortcut', async () => {
    setup();
    render(<Shell />);
    const term = await screen.findByTestId('term-c1');
    const ev = createEvent.keyDown(term, {
      key: '1',
      code: 'KeyQ',
      ctrlKey: true,
      metaKey: true,
    });
    fireEvent(term, ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('leaves other keys alone', async () => {
    setup();
    render(<Shell />);
    const term = await screen.findByTestId('term-c1');
    const ev = createEvent.keyDown(term, { key: 'c', ctrlKey: true });
    fireEvent(term, ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('keeps the same terminal node across Usage, terminals and Focus', async () => {
    setup();
    render(<Shell />);
    const before = await screen.findByTestId('term-c1');
    await userEvent.click(screen.getByRole('tab', { name: /Usage/ }));
    await userEvent.click(screen.getByRole('tab', { name: 'Claude Code' }));
    fireEvent.keyDown(window, FOCUS_KEYS);
    expect(screen.getByTestId('term-c1')).toBe(before);
  });

  it('Focus hides the header and the nav, persists, and double-click toggles it back', async () => {
    setup();
    render(<Shell />);
    fireEvent.keyDown(window, FOCUS_KEYS);
    expect(screen.queryByRole('navigation', { name: 'Tasks' })).toBeNull();
    expect(document.querySelector('header.headerbar')).toBeNull();
    expect(localStorage.getItem('miac.ui.focus')).toBe('true');
    await userEvent.dblClick(
      screen.getByRole('tablist', { name: 'Terminals' }),
    );
    expect(
      screen.getByRole('navigation', { name: 'Tasks' }),
    ).toBeInTheDocument();
  });

  it('keeps the rail in Focus when the nav was collapsed', async () => {
    setup();
    useStore.setState({ navCollapsed: true });
    render(<Shell />);
    fireEvent.keyDown(window, FOCUS_KEYS);
    expect(screen.getByRole('navigation', { name: 'Tasks' })).toHaveClass(
      'is-rail',
    );
  });

  it('shows a new-usage dot on the Usage tab until it is selected', async () => {
    const { emit } = setup();
    render(<Shell />);
    await screen.findByTestId('term-c1');
    act(() => emit('usage:changed', { taskId: 'a' }));
    expect(
      screen.getByRole('tab', { name: /Usage, new usage/ }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Usage/ }));
    expect(screen.getByRole('tab', { name: 'Usage' })).toBeInTheDocument();
  });

  it('shows a changed dot on the Docs tab while another tab is active', async () => {
    const { emit } = setup();
    render(<Shell />);
    await screen.findByTestId('term-c1');
    act(() => emit('docs:changed', { taskId: 'a', paths: ['README.md'] }));
    expect(
      screen.getByRole('tab', { name: 'Docs, changed' }),
    ).toBeInTheDocument();
  });

  it('opens the Docs tab with Mod+Shift+D', async () => {
    setup();
    render(<Shell />);
    const term = await screen.findByTestId('term-c1');
    const ev = createEvent.keyDown(term, {
      key: 'D',
      code: 'KeyD',
      shiftKey: true,
      ctrlKey: true,
      metaKey: true,
    });
    fireEvent(term, ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(useStore.getState().activeTab('a')).toBe('docs');
  });

  it('falls back to Usage when a task has no terminals', async () => {
    setup({ terminals: [] });
    render(<Shell />);
    expect(
      await screen.findByRole('region', { name: 'AI usage' }),
    ).toBeVisible();
  });

  it('shows the header and nav with Focus on and no task selected', () => {
    setup();
    useStore.setState({ tasks: [], selectedTaskId: null, focus: true });
    render(<Shell />);
    expect(document.querySelector('header.headerbar')).not.toBeNull();
    expect(
      screen.getByRole('navigation', { name: 'Tasks' }),
    ).toBeInTheDocument();
  });

  it.each(['done', 'setup-failed'] as const)(
    'shows the header with Focus on and a %s task',
    (status) => {
      setup({ status, terminals: [] });
      useStore.setState({ focus: true });
      render(<Shell />);
      expect(document.querySelector('header.headerbar')).not.toBeNull();
      expect(
        screen.getByRole('navigation', { name: 'Tasks' }),
      ).toBeInTheDocument();
    },
  );

  it('keeps the tab row out of Focus chrome for a finishing task', async () => {
    setup({ status: 'finishing' });
    useStore.setState({ focus: true });
    render(<Shell />);
    const tabs = await screen.findByRole('tablist', { name: 'Terminals' });
    expect(document.querySelector('header.headerbar')).not.toBeNull();
    expect(tabs.querySelector('.tabrow-brand')).toBeNull();
    const row = tabs.parentElement!;
    expect(
      within(row).queryByRole('button', { name: 'Exit focus' }),
    ).toBeNull();
    // Focus does nothing for a task that is not ready, so no button offers it.
    expect(within(row).queryByRole('button', { name: 'Focus' })).toBeNull();
  });

  it('shows the Focus chrome in the tab row for a ready task', async () => {
    setup();
    useStore.setState({ focus: true });
    render(<Shell />);
    const tabs = await screen.findByRole('tablist', { name: 'Terminals' });
    expect(tabs.querySelector('.tabrow-brand')).not.toBeNull();
    expect(
      within(tabs.parentElement!).getByRole('button', { name: 'Exit focus' }),
    ).toBeVisible();
  });

  it('toggles Focus with the shortcut when no task is selected', () => {
    setup();
    useStore.setState({ tasks: [], selectedTaskId: null });
    render(<Shell />);
    fireEvent.keyDown(window, FOCUS_KEYS);
    expect(useStore.getState().focus).toBe(true);
    fireEvent.keyDown(window, FOCUS_KEYS);
    expect(useStore.getState().focus).toBe(false);
  });

  it('keeps the terminals mounted while another page is open, so they do not replay', async () => {
    setup();
    render(<Shell />);
    await screen.findByRole('tablist', { name: 'Terminals' });
    mounts.count = 0;
    for (const page of [
      { kind: 'settings' },
      { kind: 'new-task' },
      { kind: 'finish', taskId: 'a' },
      { kind: 'sprint' },
    ] as const) {
      act(() => useStore.getState().go(page));
      expect(screen.getByTestId('term-c1')).toHaveAttribute(
        'data-active',
        'false',
      );
      expect(screen.queryByRole('tablist', { name: 'Terminals' })).toBeNull();
      act(() => useStore.getState().go({ kind: 'task' }));
      expect(screen.getByTestId('term-c1')).toHaveAttribute(
        'data-active',
        'true',
      );
    }
    expect(mounts.count).toBe(0);
  });
});
