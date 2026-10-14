import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TaskView } from '../../shared/types';
import { useStore } from '../store';
import { emptyUsage, installFakeApi } from '../test-helpers/fakeApi';
import { TaskHeader } from './TaskHeader';

const EURO = String.fromCharCode(0x20ac);
const task: TaskView = {
  id: 't1',
  repoId: 'r1',
  name: '',
  workItem: { id: '1', type: 'Issue', title: 'Checkout', url: null },
  slug: '1-checkout',
  branch: 'feature/1-checkout',
  worktreePath: '/w',
  baseRef: 'origin/main',
  status: 'ready',
  setup: {
    copy: false,
    commands: [],
    startClaude: true,
    openShell: true,
    openCopilot: false,
  },
  terminals: [],
  createdAt: 'now',
  finishedAt: null,
  worktreeMissing: false,
  usageSyncedAt: null,
  usageSyncError: null,
  usageCommentId: null,
};
const usage = {
  ...emptyUsage('t1'),
  billable: { costUsd: 10, costEur: 9.2, tokens: 100 },
  byTool: {
    'claude-code': { costUsd: 9, costEur: 8.28, sessions: 1, tokens: 90 },
    'copilot-cli': { costUsd: 1, costEur: 0.92, sessions: 1, tokens: 10 },
  },
};

beforeEach(() => {
  useStore.setState({
    screen: { kind: 'workspace' },
    repos: [
      {
        id: 'r1',
        name: 'webshop',
        path: '/r',
        baseBranch: 'main',
        connectionId: 'c1',
        miacYmlFound: true,
      },
    ],
  });
});

describe('TaskHeader cost tile', () => {
  it('shows the billable total, the split and opens the Usage screen', async () => {
    installFakeApi({
      'usage:task': () => usage,
      'tasks:gitSummary': () => ({
        branch: 'b',
        ahead: 0,
        behind: 0,
        hasUpstream: false,
        files: [],
      }),
    });
    render(<TaskHeader task={task} />);
    expect(await screen.findByText(`${EURO}9.20`)).toBeTruthy();
    expect(screen.getByText(/Claude .8\.28/)).toBeTruthy();
    expect(screen.getByText('Not logged on the work item yet')).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', { name: /AI cost for this task/ }),
    );
    expect(useStore.getState().screen).toEqual({ kind: 'usage', taskId: 't1' });
  });
  it('refreshes on usage:changed and shows a sync error', async () => {
    let current = emptyUsage('t1');
    const { emit } = installFakeApi({
      'usage:task': () => current,
      'tasks:gitSummary': () => ({
        branch: 'b',
        ahead: 0,
        behind: 0,
        hasUpstream: false,
        files: [],
      }),
    });
    render(
      <TaskHeader
        task={{
          ...task,
          usageSyncError:
            'The token cannot write work items (needs Work Items: Read & write)',
        }}
      />,
    );
    expect(await screen.findByText(`${EURO}0.00`)).toBeTruthy();
    current = usage;
    emit('usage:changed', { taskId: 't1' });
    await waitFor(() => expect(screen.getByText(`${EURO}9.20`)).toBeTruthy());
    expect(
      screen.getByText(/Sync failed: The token cannot write/),
    ).toBeTruthy();
  });
});
