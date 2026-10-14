import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TaskView } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { FinishScreen } from './FinishScreen';

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
  worktreePath: '/w/a',
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
const dirty = {
  uncommitted: [
    { status: 'M', path: 'src/a.ts' },
    { status: '?', path: 'src/b.ts' },
  ],
  unpushed: 2,
  runningTerminals: 2,
};
const clean = { uncommitted: [], unpushed: 0, runningTerminals: 0 };

beforeEach(() =>
  useStore.setState({
    repos: [],
    tasks: [task],
    connections: [],
    notices: [],
    screen: { kind: 'finish', taskId: 'a' },
    selectedTaskId: 'a',
  }),
);

describe('FinishScreen', () => {
  it('shows the safety checks and the cleanup options', async () => {
    installFakeApi({ 'tasks:finishChecks': () => dirty });
    render(<FinishScreen taskId="a" />);
    expect(
      await screen.findByText('2 uncommitted changes'),
    ).toBeInTheDocument();
    expect(screen.getByText(/M src\/a\.ts/)).toBeInTheDocument();
    expect(screen.getByText('2 commits not pushed')).toBeInTheDocument();
    expect(screen.getByText('2 terminals still running')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Close 2 terminals (Claude Code, zsh)'),
    ).toBeChecked();
    expect(screen.getByLabelText('Remove worktree folder')).toBeChecked();
    expect(screen.getByLabelText(/Delete local branch/)).toBeChecked();
    expect(
      screen.getByRole('button', { name: 'Discard changes and clean up' }),
    ).toBeInTheDocument();
  });

  it('shows green checks and a plain finish button when clean', async () => {
    installFakeApi({ 'tasks:finishChecks': () => clean });
    render(<FinishScreen taskId="a" />);
    expect(
      await screen.findByText('No uncommitted changes'),
    ).toBeInTheDocument();
    expect(screen.getByText('Nothing to push')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Finish and clean up' }),
    ).toBeInTheDocument();
  });

  it('finishes with the chosen options and returns to the workspace', async () => {
    const { calls } = installFakeApi({
      'tasks:finishChecks': () => clean,
      'tasks:finish': () => undefined,
    });
    render(<FinishScreen taskId="a" />);
    await userEvent.click(await screen.findByLabelText(/Delete local branch/));
    await userEvent.click(
      screen.getByRole('button', { name: 'Finish and clean up' }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.channel === 'tasks:finish')?.args).toEqual([
        'a',
        { closeTerminals: true, removeWorktree: true, deleteBranch: false },
      ]),
    );
    expect(useStore.getState().screen).toEqual({ kind: 'workspace' });
  });

  it('opens commit and push in a terminal tab', async () => {
    const { calls } = installFakeApi({
      'tasks:finishChecks': () => dirty,
      'terminals:open': () => ({
        id: 'g1',
        kind: 'run',
        label: 'git commit',
        command: 'x',
      }),
    });
    render(<FinishScreen taskId="a" />);
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Commit' + String.fromCharCode(0x2026),
      }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.channel === 'terminals:open')?.args).toEqual([
        'a',
        {
          kind: 'run',
          label: 'git commit',
          command: 'git add -A && git commit',
        },
      ]),
    );
    expect(useStore.getState().screen).toEqual({ kind: 'workspace' });
  });

  it('stays open and shows the error when finishing fails', async () => {
    installFakeApi({
      'tasks:finishChecks': () => clean,
      'tasks:finish': () => {
        throw new Error('git worktree remove failed: locked');
      },
    });
    render(<FinishScreen taskId="a" />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Finish and clean up' }),
    );
    await waitFor(() =>
      expect(useStore.getState().notices[0]?.message).toMatch(/locked/),
    );
    expect(useStore.getState().screen).toEqual({ kind: 'finish', taskId: 'a' });
  });

  it('lets you clean up without checks when inspecting fails', async () => {
    const { calls } = installFakeApi({
      'tasks:finishChecks': () => {
        throw new Error('worktree gone');
      },
      'tasks:finish': () => undefined,
    });
    render(<FinishScreen taskId="a" />);
    expect(
      await screen.findByText(
        /Could not inspect the worktree: .*worktree gone/,
      ),
    ).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Clean up without checks' });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'tasks:finish')).toBe(true),
    );
  });

  it('does not fetch checks for a task that is not ready', async () => {
    useStore.setState({ tasks: [{ ...task, status: 'setup-failed' }] });
    const { calls } = installFakeApi({ 'tasks:finishChecks': () => clean });
    render(<FinishScreen taskId="a" />);
    expect(
      screen.getByText(
        /This task is setup-failed\. Finish it once setup has succeeded/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Keep task' }),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.channel === 'tasks:finishChecks')).toBe(false);
  });

  it('lists uncommitted files in a scrollable block', async () => {
    installFakeApi({
      'tasks:finishChecks': () => ({
        ...dirty,
        uncommitted: [
          { status: 'M', path: 'src/a.ts' },
          { status: 'M', path: 'src/b.ts' },
          { status: 'M', path: 'src/c.ts' },
        ],
      }),
    });
    render(<FinishScreen taskId="a" />);
    const el = await screen.findByText(/M src\/a\.ts/);
    expect(el).toHaveClass('files');
    expect(el.textContent).toContain('src/b.ts');
    expect(el.textContent).toContain('src/c.ts');
  });

  it('disables the terminal checkbox when there are no terminals', async () => {
    useStore.setState({ tasks: [{ ...task, terminals: [] }] });
    installFakeApi({ 'tasks:finishChecks': () => clean });
    render(<FinishScreen taskId="a" />);
    const box = await screen.findByLabelText('Close 0 terminals');
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
  });
});
