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
import { WorkspaceScreen } from './WorkspaceScreen';

vi.mock('../components/TerminalView', () => ({
  TerminalView: ({
    terminalId,
    active,
  }: {
    terminalId: string;
    active: boolean;
  }) => <div data-testid={`term-${terminalId}`} data-active={active} />,
}));

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
      },
    ],
    tasks: [task],
    connections: [],
    notices: [],
    screen: { kind: 'workspace' },
    selectedTaskId: 'a',
  }),
);

describe('WorkspaceScreen', () => {
  it('shows the task strip with git state and the terminal tabs', async () => {
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
    render(<WorkspaceScreen />);
    expect(
      within(screen.getByRole('banner')).getByText(
        'Checkout: allow saving a delivery address',
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
    render(<WorkspaceScreen />);
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
    render(<WorkspaceScreen />);
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

  it('opens the editor and the finish dialog from the header', async () => {
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
    render(<WorkspaceScreen />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Open in VS Code' }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'tasks:openInEditor')).toBe(true),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Finish task' }));
    expect(useStore.getState().screen).toEqual({ kind: 'finish', taskId: 'a' });
  });

  it('shows the usage panel for a done task', async () => {
    installFakeApi();
    useStore.setState({
      tasks: [
        {
          ...task,
          status: 'done',
          terminals: [],
          finishedAt: '2026-10-14T12:00:00.000Z',
        },
      ],
    });
    render(<WorkspaceScreen />);
    expect(screen.getByText(/This task is done/)).toBeInTheDocument();
    expect(
      await screen.findByRole('region', { name: 'AI usage' }),
    ).toBeInTheDocument();
    expect(useStore.getState().activeTab('a')).toBe('usage');
  });

  it('shows an empty state without a selected task', () => {
    installFakeApi();
    useStore.setState({ tasks: [], selectedTaskId: null });
    render(<WorkspaceScreen />);
    expect(screen.getByText(/No task selected/)).toBeInTheDocument();
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
    render(<WorkspaceScreen />);
    expect(screen.getByTestId('term-c1')).toBeInTheDocument();
    act(() => useStore.setState({ selectedTaskId: 'b' }));
    expect(
      within(screen.getByRole('banner')).getByText('Second task'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('term-c2')).toHaveAttribute(
      'data-active',
      'true',
    );
    expect(screen.queryByTestId('term-c1')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Claude Code/ })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
  });

  it('shows an Open setup panel instead of the terminals for a setup-failed task', async () => {
    installFakeApi();
    useStore.setState({ tasks: [{ ...task, status: 'setup-failed' }] });
    render(<WorkspaceScreen />);
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
    render(<WorkspaceScreen />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      expect.stringContaining('Usage'),
      'Claude Code',
      'zsh',
    ]);
  });

  it('switches with Mod+0 and Mod+2 even when the key comes from inside the terminal', async () => {
    setup();
    render(<WorkspaceScreen />);
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

  it('leaves other keys alone', async () => {
    setup();
    render(<WorkspaceScreen />);
    const term = await screen.findByTestId('term-c1');
    const ev = createEvent.keyDown(term, { key: 'c', ctrlKey: true });
    fireEvent(term, ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('keeps the same terminal node across Usage, terminals and Focus', async () => {
    setup();
    render(<WorkspaceScreen />);
    const before = await screen.findByTestId('term-c1');
    await userEvent.click(screen.getByRole('tab', { name: /Usage/ }));
    await userEvent.click(screen.getByRole('tab', { name: 'Claude Code' }));
    fireEvent.keyDown(window, FOCUS_KEYS);
    expect(screen.getByTestId('term-c1')).toBe(before);
  });

  it('Focus hides the strip and the nav, persists, and double-click toggles it back', async () => {
    setup();
    render(<WorkspaceScreen />);
    fireEvent.keyDown(window, FOCUS_KEYS);
    expect(screen.queryByRole('navigation', { name: 'Tasks' })).toBeNull();
    expect(document.querySelector('header.strip')).toBeNull();
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
    render(<WorkspaceScreen />);
    fireEvent.keyDown(window, FOCUS_KEYS);
    expect(screen.getByRole('navigation', { name: 'Tasks' })).toHaveClass(
      'is-rail',
    );
  });

  it('shows a new-usage dot on the Usage tab until it is selected', async () => {
    const { emit } = setup();
    render(<WorkspaceScreen />);
    await screen.findByTestId('term-c1');
    act(() => emit('usage:changed', { taskId: 'a' }));
    expect(
      screen.getByRole('tab', { name: /Usage, new usage/ }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Usage/ }));
    expect(screen.getByRole('tab', { name: 'Usage' })).toBeInTheDocument();
  });

  it('falls back to Usage when a task has no terminals', async () => {
    setup({ terminals: [] });
    render(<WorkspaceScreen />);
    expect(
      await screen.findByRole('region', { name: 'AI usage' }),
    ).toBeVisible();
  });

  it('shows the crumb strip and nav with Focus on and no task selected', () => {
    setup();
    useStore.setState({ tasks: [], selectedTaskId: null, focus: true });
    render(<WorkspaceScreen />);
    expect(document.querySelector('header.strip')).not.toBeNull();
    expect(
      screen.getByRole('navigation', { name: 'Tasks' }),
    ).toBeInTheDocument();
  });

  it.each(['done', 'setup-failed'] as const)(
    'shows the strip with Focus on and a %s task',
    (status) => {
      setup({ status, terminals: [] });
      useStore.setState({ focus: true });
      render(<WorkspaceScreen />);
      expect(document.querySelector('header.strip')).not.toBeNull();
      expect(
        screen.getByRole('navigation', { name: 'Tasks' }),
      ).toBeInTheDocument();
    },
  );

  it('toggles Focus with the shortcut when no task is selected', () => {
    setup();
    useStore.setState({ tasks: [], selectedTaskId: null });
    render(<WorkspaceScreen />);
    fireEvent.keyDown(window, FOCUS_KEYS);
    expect(useStore.getState().focus).toBe(true);
    fireEvent.keyDown(window, FOCUS_KEYS);
    expect(useStore.getState().focus).toBe(false);
  });
});
