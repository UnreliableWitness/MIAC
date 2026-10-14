import { act, render, screen, waitFor } from '@testing-library/react';
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

const AHEAD_BEHIND = `${String.fromCharCode(0x2191)}2 ${String.fromCharCode(0x2193)}0`;

const task: TaskView = {
  id: 'a',
  repoId: 'r1',
  name: '',
  workItem: {
    id: '48213',
    type: 'User Story',
    title: 'Checkout: allow saving a delivery address',
  },
  slug: 'a',
  branch: 'feature/48213-save-delivery-address',
  worktreePath: '/src/webshop.worktrees/48213-save-delivery-address',
  baseRef: 'origin/main',
  status: 'ready',
  setup: { copy: true, commands: [], startClaude: true, openShell: true },
  terminals: [
    { id: 'c1', kind: 'claude', label: 'Claude Code' },
    { id: 's1', kind: 'shell', label: 'zsh' },
  ],
  createdAt: 'now',
  finishedAt: null,
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
    notices: [],
    screen: { kind: 'workspace' },
    selectedTaskId: 'a',
  }),
);

describe('WorkspaceScreen', () => {
  it('shows the task header with git summary and the terminal tabs', async () => {
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
      screen.getByRole('heading', {
        name: 'Checkout: allow saving a delivery address',
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText(AHEAD_BEHIND)).toBeInTheDocument();
    expect(screen.getByText('3 changed')).toBeInTheDocument();
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
      workItem: { id: '2', type: 'Bug', title: 'Second task' },
      terminals: [{ id: 'c2', kind: 'claude', label: 'Claude Code' }],
    };
    useStore.setState({ tasks: [task, second] });
    render(<WorkspaceScreen />);
    expect(screen.getByTestId('term-c1')).toBeInTheDocument();
    act(() => useStore.setState({ selectedTaskId: 'b' }));
    expect(
      screen.getByRole('heading', { name: 'Second task' }),
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
});
