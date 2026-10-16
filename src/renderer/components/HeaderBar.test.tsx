import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GitSummary, TaskView } from '../../shared/types';
import { useStore } from '../store';
import { emptyUsage, installFakeApi } from '../test-helpers/fakeApi';
import { HeaderBar } from './HeaderBar';

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
  await userEvent.tab(); // MIAC
  await userEvent.tab(); // project
  await userEvent.tab(); // task crumb
  return screen.findByRole('dialog', { name: 'Task details' });
}

const crumbs = () =>
  within(screen.getByRole('navigation', { name: 'Breadcrumb' }))
    .getAllByRole('button')
    .map((b) => b.textContent);

beforeEach(() => {
  useStore.setState({
    screen: { kind: 'task' },
    previous: null,
    tasks: [task],
    selectedTaskId: 'a',
    connectionId: null,
    repos: [
      {
        id: 'r1',
        name: 'webshop',
        path: '/r',
        baseBranch: 'main',
        connectionId: 'c1',
        miacYmlFound: true,
        workItemOnStart: {
          moveToInProgress: true,
          assignToMe: true,
          stateOverrides: {},
        },
      },
    ],
    connections: [
      {
        id: 'c1',
        name: 'unreliablewitness',
        organizationUrl: 'https://dev.azure.com/unreliablewitness',
        project: 'DXP',
        user: 'D',
        status: 'ok',
        checkedAt: null,
        userUniqueName: null,
      },
    ],
  });
});

describe('HeaderBar', () => {
  it('shows MIAC, the project and the task as breadcrumb links', async () => {
    installFakeApi();
    render(<HeaderBar />);
    expect(crumbs()).toEqual([
      'MIAC',
      'DXP',
      'User Story 48213 Checkout: allow saving a delivery address',
    ]);
    expect(
      screen.getByRole('button', { name: /User Story 48213/ }),
    ).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'DXP' }));
    expect(useStore.getState().screen).toEqual({ kind: 'sprint' });
  });
  it('names the page for Sprint, Settings, Setup, Finish and New task', () => {
    installFakeApi();
    const { rerender } = render(<HeaderBar />);
    const at = (
      screen: Parameters<ReturnType<typeof useStore.getState>['go']>[0],
    ) => {
      useStore.setState({ screen });
      rerender(<HeaderBar />);
      return crumbs();
    };
    expect(at({ kind: 'sprint' })).toEqual(['MIAC', 'DXP', 'Sprint']);
    expect(at({ kind: 'settings' })).toEqual(['MIAC', 'Settings']);
    expect(at({ kind: 'new-task' })).toEqual(['MIAC', 'DXP', 'New task']);
    expect(at({ kind: 'setup', taskId: 'a' })).toEqual([
      'MIAC',
      'DXP',
      'User Story 48213 Checkout: allow saving a delivery address',
      'Setup',
    ]);
    expect(at({ kind: 'finish', taskId: 'a' }).at(-1)).toBe('Finish');
  });
  it('leaves out the project without a connection', () => {
    installFakeApi();
    useStore.setState({ connections: [], screen: { kind: 'sprint' } });
    render(<HeaderBar />);
    expect(crumbs()).toEqual(['MIAC', 'Sprint']);
  });
  it('goes to Sprint from the MIAC crumb', async () => {
    installFakeApi();
    useStore.setState({ screen: { kind: 'settings' } });
    render(<HeaderBar />);
    await userEvent.click(
      screen.getByRole('button', { name: 'MIAC, go to Sprint' }),
    );
    expect(useStore.getState().screen).toEqual({ kind: 'sprint' });
  });
  it('has New task and Settings actions', async () => {
    installFakeApi();
    render(<HeaderBar />);
    await userEvent.click(screen.getByRole('button', { name: 'New task' }));
    expect(useStore.getState().screen).toEqual({ kind: 'new-task' });
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(useStore.getState().screen).toEqual({ kind: 'settings' });
  });
  it('opens the detail card on task crumb focus and closes it with Escape', async () => {
    installFakeApi({ 'tasks:gitSummary': () => git });
    render(<HeaderBar />);
    const card = await openCard();
    expect(card).toHaveTextContent('User Story 48213');
    expect(card).toHaveTextContent(
      '/src/webshop.worktrees/48213-save-delivery-address',
    );
    expect(card).toHaveTextContent('Not logged on the work item yet');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Task details' })).toBeNull();
    // The card took the Escape; the page did not navigate.
    expect(useStore.getState().screen).toEqual({ kind: 'task' });
  });
  it('closes the card when focus tabs past its last control', async () => {
    installFakeApi({ 'tasks:gitSummary': () => git });
    useStore.setState({
      tasks: [
        {
          ...task,
          workItem: { ...task.workItem!, url: 'https://example.test/48213' },
        },
      ],
    });
    render(<HeaderBar />);
    await openCard();
    await userEvent.tab(); // ADO link inside the card
    expect(screen.getByRole('dialog', { name: 'Task details' })).toBeTruthy();
    await userEvent.tab(); // out of the card
    expect(screen.queryByRole('dialog', { name: 'Task details' })).toBeNull();
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
    render(<HeaderBar />);
    const card = await openCard();
    await waitFor(() =>
      expect(card).toHaveTextContent(
        `${String.fromCharCode(0x2191)}2 ${String.fromCharCode(0x2193)}0`,
      ),
    );
    expect(card).toHaveTextContent('3 changed');
  });
  it('opens the work item in Azure DevOps from the card', async () => {
    const url =
      'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/48213';
    const { calls } = installFakeApi({
      'tasks:gitSummary': () => git,
      'shell:openExternal': () => undefined,
    });
    useStore.setState({
      tasks: [{ ...task, workItem: { ...task.workItem!, url } }],
    });
    render(<HeaderBar />);
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
    render(<HeaderBar />);
    const card = await openCard();
    expect(
      screen.queryByRole('button', { name: /in Azure DevOps/ }),
    ).not.toBeInTheDocument();
    expect(within(card).getByText('User Story 48213')).toBeInTheDocument();
  });
  it('shows the Claude and Copilot split and a sync error in the card', async () => {
    installFakeApi({
      'usage:task': () => usage,
      'tasks:gitSummary': () => git,
    });
    useStore.setState({
      tasks: [
        {
          ...task,
          usageSyncError:
            'The token cannot write work items (needs Work Items: Read & write)',
        },
      ],
    });
    render(<HeaderBar />);
    const card = await openCard();
    await waitFor(() => expect(card).toHaveTextContent(/Claude .8\.28/));
    expect(card).toHaveTextContent(/Copilot .0\.92/);
    expect(
      within(card).getByText(/Sync failed: The token cannot write/),
    ).toBeTruthy();
  });
});
