import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitSummary, TaskView } from '../../shared/types';
import { useStore } from '../store';
import { emptyUsage, installFakeApi } from '../test-helpers/fakeApi';
import { CrumbStrip, TaskStrip } from './TaskStrip';

const EURO = String.fromCharCode(0x20ac);
const UP = String.fromCharCode(0x2191);
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
const git: GitSummary = {
  branch: 'feature/48213-save-delivery-address',
  ahead: 2,
  behind: 0,
  hasUpstream: true,
  files: [{ status: 'M', path: 'a' }],
};
const usage = {
  ...emptyUsage('a'),
  billable: { costUsd: 10, costEur: 9.2, tokens: 100 },
  byTool: {
    'claude-code': { costUsd: 9, costEur: 8.28, sessions: 1, tokens: 90 },
    'copilot-cli': { costUsd: 1, costEur: 0.92, sessions: 1, tokens: 10 },
  },
};

async function openCard() {
  await userEvent.tab(); // MIAC home button
  await userEvent.tab(); // title
  return screen.findByRole('dialog', { name: 'Task details' });
}

beforeEach(() => {
  useStore.setState({
    screen: { kind: 'workspace' },
    tasks: [task],
    selectedTaskId: 'a',
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

describe('TaskStrip', () => {
  it('shows id, title, branch, git state and cost', async () => {
    installFakeApi({
      'tasks:gitSummary': () => git,
      'usage:task': (id) => ({
        ...emptyUsage(id as string),
        billable: { costUsd: 25, costEur: 23, tokens: 1 },
      }),
    });
    render(<TaskStrip task={task} />);
    expect(screen.getByText('48213')).toBeInTheDocument();
    expect(
      screen.getByText('Checkout: allow saving a delivery address'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/feature\/48213-save-delivery-address/),
    ).toBeInTheDocument();
    expect(await screen.findByText(new RegExp(`${UP}2`))).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /AI cost .*23\.00/ }),
    ).toBeInTheDocument();
  });
  it('opens the Usage tab from the cost gauge', async () => {
    installFakeApi({ 'tasks:gitSummary': () => git });
    render(<TaskStrip task={task} />);
    await userEvent.click(
      await screen.findByRole('button', { name: /AI cost/ }),
    );
    expect(useStore.getState().activeTab(task.id)).toBe('usage');
  });
  it('opens the detail card on title focus and closes it with Escape', async () => {
    installFakeApi({ 'tasks:gitSummary': () => git });
    render(<TaskStrip task={task} />);
    const card = await openCard();
    expect(card).toHaveTextContent('User Story 48213');
    expect(card).toHaveTextContent(
      '/src/webshop.worktrees/48213-save-delivery-address',
    );
    expect(card).toHaveTextContent('Not logged on the work item yet');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Task details' })).toBeNull();
  });
  it('has Open in VS Code, Finish task, New task and Settings actions', async () => {
    installFakeApi({ 'tasks:gitSummary': () => git });
    render(<TaskStrip task={task} />);
    for (const name of [
      'Open in VS Code',
      'Finish task',
      'New task',
      'Settings',
    ])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Finish task' }));
    expect(useStore.getState().screen).toEqual({
      kind: 'finish',
      taskId: task.id,
    });
  });
  it('goes home from the MIAC button', async () => {
    installFakeApi({ 'tasks:gitSummary': () => git });
    useStore.setState({ screen: { kind: 'settings' } });
    render(<TaskStrip task={task} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'MIAC, back to tasks' }),
    );
    expect(useStore.getState().screen).toEqual({ kind: 'workspace' });
  });
  it('opens the editor, and disables it when the worktree is missing', async () => {
    const { calls } = installFakeApi({
      'tasks:gitSummary': () => git,
      'tasks:openInEditor': () => undefined,
    });
    const { rerender } = render(<TaskStrip task={task} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Open in VS Code' }),
    );
    await waitFor(() =>
      expect(
        calls.find((c) => c.channel === 'tasks:openInEditor')?.args,
      ).toEqual(['a']),
    );
    rerender(<TaskStrip task={{ ...task, worktreeMissing: true }} />);
    expect(
      screen.getByRole('button', { name: 'Open in VS Code' }),
    ).toBeDisabled();
  });
  it('shows the git summary, changed files and clean state in the card', async () => {
    installFakeApi({
      'tasks:gitSummary': () => ({
        ...git,
        files: [
          { status: 'M', path: 'a' },
          { status: 'M', path: 'b' },
          { status: '?', path: 'c' },
        ],
      }),
    });
    render(<TaskStrip task={task} />);
    await screen.findByText(new RegExp(`${UP}2`));
    const card = await openCard();
    expect(card).toHaveTextContent(`${UP}2 ${String.fromCharCode(0x2193)}0`);
    expect(card).toHaveTextContent('3 changed');
  });
  it('opens the work item in Azure DevOps from the card badge', async () => {
    const url =
      'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/48213';
    const { calls } = installFakeApi({
      'tasks:gitSummary': () => git,
      'shell:openExternal': () => undefined,
    });
    render(
      <TaskStrip task={{ ...task, workItem: { ...task.workItem!, url } }} />,
    );
    await openCard();
    await userEvent.click(
      screen.getByRole('button', {
        name: /Open User Story 48213 in Azure DevOps/,
      }),
    );
    await waitFor(() =>
      expect(
        calls.find((c) => c.channel === 'shell:openExternal')?.args,
      ).toEqual([url]),
    );
  });
  it('shows a plain badge for work items without a url', async () => {
    installFakeApi({ 'tasks:gitSummary': () => git });
    render(<TaskStrip task={task} />);
    await openCard();
    expect(
      screen.queryByRole('button', { name: /in Azure DevOps/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('User Story 48213')).toBeInTheDocument();
  });
  it('shows the billable total and the Claude and Copilot split', async () => {
    installFakeApi({
      'usage:task': () => usage,
      'tasks:gitSummary': () => git,
    });
    render(<TaskStrip task={task} />);
    expect(await screen.findByText(`${EURO}9.20`)).toBeTruthy();
    const card = await openCard();
    await waitFor(() => expect(card).toHaveTextContent(/Claude .8\.28/));
    expect(card).toHaveTextContent('Not logged on the work item yet');
  });
  it('refreshes on usage:changed and shows a sync error', async () => {
    let current = emptyUsage('a');
    const { emit } = installFakeApi({
      'usage:task': () => current,
      'tasks:gitSummary': () => git,
    });
    render(
      <TaskStrip
        task={{
          ...task,
          usageSyncError:
            'The token cannot write work items (needs Work Items: Read & write)',
        }}
      />,
    );
    expect(await screen.findByText(`${EURO}0.00`)).toBeTruthy();
    current = usage;
    emit('usage:changed', { taskId: 'a' });
    await waitFor(() => expect(screen.getByText(`${EURO}9.20`)).toBeTruthy());
    await openCard();
    expect(
      screen.getByText(/Sync failed: The token cannot write/),
    ).toBeTruthy();
  });
});

describe('CrumbStrip', () => {
  it('shows the crumb and a back link', async () => {
    const back = vi.fn();
    render(
      <CrumbStrip
        crumb="Settings"
        back={{ label: 'Back to tasks', onClick: back }}
      />,
    );
    expect(screen.getByText('Settings')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Back to tasks' }),
    );
    expect(back).toHaveBeenCalled();
  });
});
