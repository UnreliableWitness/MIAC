import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo, TaskView, TaskWorktree } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { ReposScreen } from './ReposScreen';

const repo = (id: string, name: string, connectionId: string | null): Repo => ({
  id,
  name,
  path: `/src/${name}`,
  baseBranch: 'main',
  connectionId,
  miacYmlFound: true,
  workItemOnStart: {
    moveToInProgress: true,
    assignToMe: true,
    stateOverrides: {},
  },
});
const wt = (repoId: string, dir: string): TaskWorktree => ({
  repoId,
  dir,
  path: `/tasks/5-store/${dir}`,
  branch: 'feature/5-store',
  baseRef: 'origin/main',
  baseSha: 'abc',
  status: 'ready',
  copy: true,
  commands: [],
  summary: null,
  pullRequest: null,
  reopen: null,
});
const task = (worktrees: TaskWorktree[]): TaskView => ({
  id: 't1',
  repoId: worktrees[0].repoId,
  name: '',
  workItem: { id: '5', type: 'Task', title: 'Store it', url: null },
  slug: '5-store',
  branch: 'feature/5-store',
  worktreePath: '/tasks/5-store',
  folder: '/tasks/5-store',
  worktrees,
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
  terminals: [],
  createdAt: 'now',
  finishedAt: null,
  usageSyncedAt: null,
  usageSyncError: null,
  usageCommentId: null,
  summary: null,
  pullRequest: null,
  closedTerminals: [],
  reopen: null,
  worktreeMissing: false,
});

const config = {
  worktreeRoot: '/w',
  config: {
    base: 'develop',
    branch: '{type}/{id}-{slug}',
    copy: ['.env'],
    setup: ['npm ci'],
    run: {},
    found: true,
  },
};

beforeEach(() =>
  useStore.setState({
    repos: [
      repo('r1', 'webshop', 'c1'),
      repo('r2', 'api', 'c1'),
      repo('r3', 'other', 'c2'),
      repo('r4', 'tools', null),
    ],
    tasks: [task([wt('r1', 'webshop')])],
    connections: [],
    notices: [],
    screen: { kind: 'repos', taskId: 't1' },
  }),
);

describe('ReposScreen', () => {
  it('lists the task’s repos and offers only repos of the same project, or none', async () => {
    installFakeApi({
      'repos:config': () => config,
      'tasks:gitSummary': () => ({
        branch: 'feature/5-store',
        ahead: 2,
        behind: 0,
        hasUpstream: false,
        files: [],
        repos: [
          { repoId: 'r1', dir: 'webshop', ahead: 2, behind: 0, files: 1 },
        ],
      }),
    });
    render(<ReposScreen taskId="t1" />);
    const list = screen.getByRole('list', { name: 'Repos in this task' });
    const row = within(list).getByRole('listitem', { name: 'webshop' });
    expect(row).toHaveTextContent('feature/5-store');
    expect(await within(row).findByText('2 commits, 1 changed')).toBeTruthy();
    const pick = screen.getByLabelText('Repo to add');
    expect(
      within(pick)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['api', 'tools']);
    // A task with one repo cannot lose it.
    expect(
      within(row).getByRole('button', { name: 'Remove webshop' }),
    ).toBeDisabled();
  });

  it('adds a repo with its .miac.yml defaults, replacing another one, and opens its setup', async () => {
    const { calls } = installFakeApi({
      'repos:config': () => config,
      'tasks:addRepo': () => undefined,
    });
    render(<ReposScreen taskId="t1" />);
    await waitFor(() =>
      expect(screen.getByLabelText('Base')).toHaveValue('origin/develop'),
    );
    await userEvent.selectOptions(screen.getByLabelText('Replace'), 'r1');
    await userEvent.click(screen.getByRole('button', { name: 'Add repo' }));
    await waitFor(() =>
      expect(calls.find((c) => c.channel === 'tasks:addRepo')?.args).toEqual([
        't1',
        {
          repoId: 'r2',
          baseRef: 'origin/develop',
          copy: true,
          commands: ['npm ci'],
          replaces: 'r1',
        },
      ]),
    );
    expect(useStore.getState().screen).toEqual({
      kind: 'setup',
      taskId: 't1',
      repoId: 'r2',
    });
  });

  it('removes a repo after a confirm, and asks again when it has work', async () => {
    useStore.setState({
      tasks: [task([wt('r1', 'webshop'), wt('r2', 'api')])],
    });
    let attempts = 0;
    const { calls } = installFakeApi({
      'repos:config': () => config,
      'tasks:removeRepo': () => {
        attempts++;
        if (attempts === 1)
          throw new Error(
            "Error invoking remote method 'tasks:removeRepo': Error: REPO_HAS_WORK: 1 commit, 2 uncommitted changes",
          );
      },
    });
    render(<ReposScreen taskId="t1" />);
    const row = screen.getByRole('listitem', { name: 'api' });
    await userEvent.click(
      within(row).getByRole('button', { name: 'Remove api' }),
    );
    const confirm = within(row).getByRole('group', {
      name: 'Remove api from this task',
    });
    await userEvent.click(within(confirm).getByLabelText(/Also delete branch/));
    await userEvent.click(
      within(confirm).getByRole('button', { name: 'Remove' }),
    );
    expect(
      await within(confirm).findByText(
        'api has 1 commit, 2 uncommitted changes. Removing it loses the uncommitted changes, and the commits too unless the branch is kept.',
      ),
    ).toBeTruthy();
    await userEvent.click(
      within(confirm).getByRole('button', { name: 'Remove anyway' }),
    );
    await waitFor(() =>
      expect(
        calls
          .filter((c) => c.channel === 'tasks:removeRepo')
          .map((c) => c.args),
      ).toEqual([
        ['t1', 'r2', { force: false, deleteBranch: true }],
        ['t1', 'r2', { force: true, deleteBranch: true }],
      ]),
    );
    expect(useStore.getState().notices).toEqual([]);
  });
});
