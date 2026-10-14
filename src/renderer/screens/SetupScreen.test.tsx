import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SetupState, TaskView } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { SetupScreen } from './SetupScreen';

const task: TaskView = {
  id: 't1',
  repoId: 'r1',
  name: '',
  workItem: {
    id: '48231',
    type: 'User Story',
    title: 'Show estimated delivery date',
  },
  slug: '48231-show',
  branch: 'feature/48231-show',
  worktreePath: '/src/webshop.worktrees/48231-show',
  baseRef: 'origin/main',
  status: 'setting-up',
  setup: {
    copy: true,
    commands: ['npm ci'],
    startClaude: true,
    openShell: true,
  },
  terminals: [],
  createdAt: 'now',
  finishedAt: null,
  worktreeMissing: false,
};
const state: SetupState = {
  steps: [
    {
      def: { kind: 'fetch', label: 'Fetch base', detail: 'origin/main' },
      status: 'done',
      ms: 400,
    },
    {
      def: {
        kind: 'worktree',
        label: 'Create branch and worktree',
        detail: 'feature/48231-show',
      },
      status: 'running',
    },
    {
      def: {
        kind: 'command',
        label: 'npm ci',
        detail: 'in worktree',
        command: 'npm ci',
      },
      status: 'todo',
    },
  ],
  log: ['$ git fetch origin/main'],
  finished: false,
  ok: null,
  failedStep: null,
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
    screen: { kind: 'setup', taskId: 't1' },
  }),
);

describe('SetupScreen', () => {
  it('shows the steps and log from the current state, then applies live events', async () => {
    const { emit } = installFakeApi({ 'tasks:setupState': () => state });
    render(<SetupScreen taskId="t1" />);
    expect(
      await screen.findByRole('listitem', {
        name: 'Create branch and worktree',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('$ git fetch origin/main')).toBeInTheDocument();
    expect(screen.getByText('0.4s')).toBeInTheDocument();
    act(() => {
      emit('setup', { taskId: 't1', type: 'log', line: 'Preparing worktree' });
      emit('setup', {
        taskId: 't1',
        type: 'step',
        index: 1,
        status: 'done',
        ms: 2100,
      });
      emit('setup', {
        taskId: 't1',
        type: 'step',
        index: 2,
        status: 'running',
      });
    });
    expect(screen.getByText('Preparing worktree')).toBeInTheDocument();
    expect(screen.getByText('2.1s')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /npm ci/ })).toHaveAttribute(
      'data-status',
      'running',
    );
  });

  it('ignores events for other tasks', async () => {
    const { emit } = installFakeApi({ 'tasks:setupState': () => state });
    render(<SetupScreen taskId="t1" />);
    await screen.findByText('Fetch base');
    act(() =>
      emit('setup', { taskId: 'other', type: 'log', line: 'not mine' }),
    );
    expect(screen.queryByText('not mine')).not.toBeInTheDocument();
  });

  it('offers retry and cancel after a failure', async () => {
    const failed: SetupState = {
      ...state,
      steps: state.steps.map((s, i) => ({
        ...s,
        status: i === 2 ? 'failed' : 'done',
        detail: i === 2 ? 'npm ci exited with code 1' : s.detail,
      })),
      finished: true,
      ok: false,
      failedStep: 2,
    };
    useStore.setState({ tasks: [{ ...task, status: 'setup-failed' }] });
    const { calls } = installFakeApi({
      'tasks:setupState': () => failed,
      'tasks:retrySetup': () => undefined,
      'tasks:cancelSetup': () => undefined,
    });
    render(<SetupScreen taskId="t1" />);
    expect(
      await screen.findByText('npm ci exited with code 1'),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Retry from npm ci' }),
    );
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.channel === 'tasks:retrySetup' && c.args[0] === 't1',
        ),
      ).toBe(true),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Cancel and remove' }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'tasks:cancelSetup')).toBe(true),
    );
    expect(useStore.getState().screen).toEqual({ kind: 'workspace' });
  });

  it('jumps to the workspace when setup finishes successfully', async () => {
    const { emit } = installFakeApi({ 'tasks:setupState': () => state });
    render(<SetupScreen taskId="t1" />);
    await screen.findByText('Fetch base');
    act(() => emit('setup', { taskId: 't1', type: 'finished', ok: true }));
    await waitFor(() =>
      expect(useStore.getState().screen).toEqual({ kind: 'workspace' }),
    );
    expect(useStore.getState().selectedTaskId).toBe('t1');
  });
});
