import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo, TaskView } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { groupTasks, TaskNav } from './TaskNav';

const repos: Repo[] = [
  {
    id: 'r1',
    name: 'webshop',
    path: '/src/webshop',
    baseBranch: 'main',
    connectionId: null,
    miacYmlFound: true,
  },
  {
    id: 'r2',
    name: 'backoffice-api',
    path: '/src/api',
    baseBranch: 'develop',
    connectionId: null,
    miacYmlFound: false,
  },
];
const base = {
  setup: { copy: true, commands: [], startClaude: true, openShell: true },
  terminals: [],
  createdAt: 'now',
  finishedAt: null,
  worktreeMissing: false,
  baseRef: 'origin/main',
};
const tasks: TaskView[] = [
  {
    ...base,
    id: 'a',
    repoId: 'r1',
    name: '',
    workItem: {
      id: '48213',
      type: 'User Story',
      title: 'Checkout: save address',
    },
    slug: 'a',
    branch: 'feature/48213-a',
    worktreePath: '/w/a',
    status: 'ready',
  },
  {
    ...base,
    id: 'b',
    repoId: 'r1',
    name: 'spike-new-search',
    workItem: null,
    slug: 'b',
    branch: 'feature/spike',
    worktreePath: '/w/b',
    status: 'setting-up',
  },
  {
    ...base,
    id: 'c',
    repoId: 'r2',
    name: '',
    workItem: { id: '47988', type: 'Task', title: 'Export orders' },
    slug: 'c',
    branch: 'feature/47988-c',
    worktreePath: '/w/c',
    status: 'done',
    finishedAt: 'then',
  },
  {
    ...base,
    id: 'd',
    repoId: 'r1',
    name: '',
    workItem: { id: '1', type: 'Bug', title: 'Broken' },
    slug: 'd',
    branch: 'bugfix/1-d',
    worktreePath: '/w/d',
    status: 'setup-failed',
  },
];

beforeEach(() =>
  useStore.setState({
    repos,
    tasks,
    notices: [],
    screen: { kind: 'workspace' },
    selectedTaskId: 'a',
  }),
);

describe('groupTasks', () => {
  it('groups open tasks by repo and collects done tasks separately', () => {
    const g = groupTasks(tasks, repos);
    expect(g.open.map((x) => [x.repo.name, x.tasks.map((t) => t.id)])).toEqual([
      ['webshop', ['a', 'b', 'd']],
    ]);
    expect(g.done.map((t) => t.id)).toEqual(['c']);
  });
});

describe('TaskNav', () => {
  it('renders rows with id or name, state dots and selects on click', async () => {
    installFakeApi();
    render(<TaskNav />);
    expect(screen.getByText('48213')).toBeInTheDocument();
    expect(screen.getByText('spike-new-search')).toBeInTheDocument();
    expect(screen.getByLabelText('Setting up')).toBeInTheDocument();
    expect(screen.getByLabelText('Setup failed')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Checkout: save address/ }),
    ).toHaveAttribute('aria-current', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Broken/ }));
    expect(useStore.getState().selectedTaskId).toBe('d');
    expect(useStore.getState().screen).toEqual({ kind: 'setup', taskId: 'd' });
  });

  it('hides done tasks behind a toggle', async () => {
    installFakeApi();
    render(<TaskNav />);
    expect(screen.queryByText('47988')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Done \(1\)/ }));
    expect(screen.getByText('47988')).toBeInTheDocument();
  });
});
