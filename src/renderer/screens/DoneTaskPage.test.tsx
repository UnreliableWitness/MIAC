import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TaskSummary, TaskView } from '../../shared/types';
import { useStore } from '../store';
import { emptyUsage, installFakeApi } from '../test-helpers/fakeApi';
import { DoneTaskPage } from './DoneTaskPage';

const created = new Date(2026, 9, 13, 9, 0);
const finished = new Date(2026, 9, 15, 12, 1);
const task: TaskView = {
  id: 'a',
  repoId: 'r1',
  name: '',
  workItem: {
    id: '1',
    type: 'Issue',
    title: 'Checkout: allow saving a delivery address',
    url: 'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/1',
  },
  slug: 'a',
  branch: 'feature/1-checkout-allow-saving-a-delivery-address',
  worktreePath: '/w/a',
  baseRef: 'origin/main',
  baseSha: null,
  status: 'done',
  setup: {
    copy: false,
    commands: [],
    startClaude: false,
    openShell: false,
    openCopilot: false,
  },
  terminals: [],
  createdAt: created.toISOString(),
  finishedAt: finished.toISOString(),
  usageSyncedAt: new Date(2026, 9, 15, 12, 2).toISOString(),
  usageSyncError: null,
  usageCommentId: 77,
  summary: null,
  worktreeMissing: false,
};
const summary: TaskSummary = {
  commits: [
    { sha: 'a1b2c3d', subject: 'Store the address on the profile' },
    { sha: 'e4f5a6b', subject: 'Show saved addresses at checkout' },
  ],
  commitCount: 3,
  filesChanged: 12,
  insertions: 340,
  deletions: 95,
  pushed: true,
  upstream: 'origin/feature/1-checkout-allow-saving-a-delivery-address',
  baseKnown: true,
};
const usage = {
  ...emptyUsage('a'),
  billable: { costUsd: 2, costEur: 1.84, tokens: 1000 },
  byTool: {
    'claude-code': { costUsd: 1.5, costEur: 1.38, sessions: 1, tokens: 800 },
    'copilot-cli': { costUsd: 0.5, costEur: 0.46, sessions: 1, tokens: 200 },
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
        connectionId: 'c1',
        miacYmlFound: true,
      },
    ],
    tasks: [task],
    connections: [],
    notices: [],
  }),
);

const fact = (label: string) =>
  screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement;

describe('DoneTaskPage', () => {
  it('shows what was done and how: facts, commits, live state', async () => {
    const { calls } = installFakeApi({
      'usage:task': () => usage,
      'workItems:get': () => ({
        id: '1',
        type: 'Issue',
        title: 'Checkout: allow saving a delivery address',
        state: 'Doing',
        areaPath: 'MIAC',
        iterationPath: 'MIAC\\Sprint 1',
        assignedTo: null,
        url: task.workItem!.url!,
      }),
    });
    render(<DoneTaskPage task={{ ...task, summary }} />);
    expect(fact('Duration')).toHaveTextContent('2 d 3 h');
    expect(fact('Finished')).toHaveTextContent('15 Oct 2026, 12:01');
    expect(fact('Branch')).toHaveTextContent(
      'feature/1-checkout-allow-saving-a-delivery-address pushed to origin',
    );
    expect(fact('Changes')).toHaveTextContent(
      `12 files, +340 ${String.fromCharCode(0x2212)}95`,
    );
    await waitFor(() =>
      expect(fact('AI cost')).toHaveTextContent(
        '€1.84 (Claude €1.38, Copilot €0.46)',
      ),
    );
    expect(fact('Logged on work item')).toHaveTextContent(
      'Yes, 15 Oct 2026, 12:02',
    );
    const commits = screen.getByRole('region', { name: 'Commits' });
    expect(
      within(commits)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'a1b2c3dStore the address on the profile',
      'e4f5a6bShow saved addresses at checkout',
    ]);
    expect(within(commits).getByText('and 1 more')).toBeInTheDocument();
    expect(await screen.findByLabelText('State Doing')).toBeInTheDocument();
    expect(calls.find((c) => c.channel === 'workItems:get')?.args).toEqual([
      'c1',
      '1',
    ]);
    expect(document.body.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(
      screen.queryByText('Finished before MIAC recorded summaries.'),
    ).toBeNull();
  });

  it('without a summary, says so instead of the commit and change facts', async () => {
    installFakeApi({ 'workItems:get': () => null });
    render(
      <DoneTaskPage
        task={{ ...task, usageCommentId: null, usageSyncError: 'offline' }}
      />,
    );
    expect(
      screen.getByText('Finished before MIAC recorded summaries.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Changes', { selector: 'dt' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Commits' })).toBeNull();
    expect(fact('Branch')).toHaveTextContent(task.branch);
    expect(fact('Logged on work item')).toHaveTextContent('No: offline');
    expect(
      await screen.findByRole('region', { name: 'AI usage' }),
    ).toBeInTheDocument();
  });

  it('hides the live state when Azure DevOps cannot be asked', async () => {
    const { calls } = installFakeApi({
      'workItems:get': () => {
        throw new Error('offline');
      },
    });
    render(<DoneTaskPage task={{ ...task, summary }} />);
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'workItems:get')).toBe(true),
    );
    expect(screen.queryByLabelText(/^State /)).toBeNull();
  });

  it('marks a local branch and a task without a work item', () => {
    installFakeApi();
    render(
      <DoneTaskPage
        task={{
          ...task,
          workItem: null,
          name: 'spike',
          summary: { ...summary, pushed: false, upstream: null },
        }}
      />,
    );
    expect(fact('Branch')).toHaveTextContent('local only');
    expect(fact('Logged on work item')).toHaveTextContent('No work item');
  });

  it('says commits are unavailable when the branch start was not found', () => {
    installFakeApi();
    render(
      <DoneTaskPage
        task={{
          ...task,
          summary: {
            ...summary,
            baseKnown: false,
            commits: [],
            commitCount: 0,
            filesChanged: 0,
            insertions: 0,
            deletions: 0,
          },
        }}
      />,
    );
    const commits = screen.getByRole('region', { name: 'Commits' });
    expect(commits).toHaveTextContent(
      'Commits unavailable: MIAC could not find where this branch started.',
    );
    expect(commits).not.toHaveTextContent('No commits on this branch.');
    expect(screen.queryByText('Changes', { selector: 'dt' })).toBeNull();
    expect(fact('Branch')).toHaveTextContent('pushed to origin');
  });

  it('a task with a recorded base but no summary does not claim to be old', () => {
    installFakeApi();
    render(<DoneTaskPage task={{ ...task, baseSha: 'abc123' }} />);
    expect(
      screen.queryByText('Finished before MIAC recorded summaries.'),
    ).toBeNull();
    expect(
      screen.getByText(
        'No summary: git could not read the branch when it finished.',
      ),
    ).toBeInTheDocument();
  });
});
