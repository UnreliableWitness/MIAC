import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Connection,
  Repo,
  Sprint,
  SprintItem,
  SprintRow,
  TaskView,
} from '../../shared/types';
import { Shell } from '../App';
import { useStore } from '../store';
import { type FakeHandlers, installFakeApi } from '../test-helpers/fakeApi';
import { visibleRows } from './SprintScreen';

vi.mock('../components/TerminalView', () => ({ TerminalView: () => null }));

const connection: Connection = {
  id: 'c1',
  name: 'uw',
  organizationUrl: 'https://dev.azure.com/unreliablewitness',
  project: 'MIAC',
  user: 'D',
  status: 'ok',
  checkedAt: null,
};
const repo: Repo = {
  id: 'r1',
  name: 'webshop',
  path: '/src/webshop',
  baseBranch: 'main',
  connectionId: 'c1',
  miacYmlFound: true,
};
const item = (
  id: number,
  type: string,
  title: string,
  over: Partial<SprintItem> = {},
): SprintItem => ({
  id: String(id),
  type,
  title,
  state: 'To Do',
  areaPath: 'MIAC',
  iterationPath: 'MIAC\\Sprint 1',
  assignedTo: 'Dries Hoebeke',
  url: `https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/${id}`,
  remainingWork: null,
  ...over,
});
const row = (
  i: SprintItem,
  depth = 0,
  parentId: string | null = null,
  hasChildren = false,
): SprintRow => ({ item: i, depth, parentId, hasChildren });
const sprint: Sprint = {
  iteration: {
    id: 'it-1',
    name: 'Sprint 1',
    path: 'MIAC\\Sprint 1',
    startDate: '2026-10-15T00:00:00Z',
    finishDate: '2026-10-28T00:00:00Z',
  },
  rows: [
    row(item(1, 'Issue', 'Save a delivery address'), 0, null, true),
    row(
      item(5, 'Task', 'Store the address', {
        remainingWork: 3,
        state: 'Doing',
      }),
      1,
      '1',
    ),
    row(item(2, 'Issue', 'Estimated delivery date')),
    row(item(4, 'Task', 'Upgrade payment SDK', { state: 'Done' })),
  ],
};
const task = (over: Partial<TaskView>): TaskView => ({
  id: 't1',
  repoId: 'r1',
  name: '',
  workItem: {
    id: '2',
    type: 'Issue',
    title: 'Estimated delivery date',
    url: null,
  },
  slug: 's',
  branch: 'feature/2-estimated-delivery-date',
  worktreePath: '/w/2',
  baseRef: 'origin/main',
  status: 'ready',
  setup: {
    copy: false,
    commands: [],
    startClaude: false,
    openShell: false,
    openCopilot: false,
  },
  terminals: [],
  createdAt: '2026-10-15T08:00:00.000Z',
  finishedAt: null,
  worktreeMissing: false,
  usageSyncedAt: null,
  usageSyncError: null,
  usageCommentId: null,
  ...over,
});

beforeEach(() =>
  useStore.setState({
    repos: [repo],
    tasks: [],
    connections: [connection],
    connectionId: null,
    notices: [],
    selectedTaskId: null,
    previous: null,
    sprintName: null,
    screen: { kind: 'sprint' },
  }),
);

const fake = (over: FakeHandlers = {}) =>
  installFakeApi({
    'workItems:sprint': () => sprint,
    'repos:config': () => ({
      worktreeRoot: '/w',
      config: {
        base: 'main',
        branch: '{type}/{id}-{slug}',
        copy: [],
        setup: [],
        run: {},
        found: true,
      },
    }),
    'workItems:currentIteration': () => sprint.iteration,
    'workItems:search': () => [],
    ...over,
  });

const grid = () => screen.findByRole('table', { name: 'Sprint 1 backlog' });
const titles = (table: HTMLElement) =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.textContent?.match(/^\D*(\d+)/)?.[1]);

describe('Sprint page', () => {
  it('shows the sprint name, its dates and the rows in ADO order with nesting', async () => {
    fake();
    render(<Shell />);
    const table = await grid();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Sprint 1' }),
    ).toBeInTheDocument();
    expect(screen.getByText('15 Oct – 28 Oct')).toBeInTheDocument();
    expect(titles(table)).toEqual(['1', '5', '2', '4']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[1]).toHaveAttribute('aria-level', '2');
    expect(
      (rows[1].querySelector('.sprint-title') as HTMLElement).style.paddingLeft,
    ).toBe('24px');
    expect(within(rows[1]).getByText('Doing')).toBeInTheDocument();
    expect(within(rows[1]).getByText('3')).toBeInTheDocument();
    // Done in ADO shows as in ADO: no extra dimming class.
    expect(rows[3].className).not.toMatch(/dim|done/);
    // The breadcrumb names the sprint.
    expect(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText(
        'Sprint 1',
      ),
    ).toBeInTheDocument();
  });

  it('collapses a parent, and collapses and expands all', async () => {
    fake();
    render(<Shell />);
    const table = await grid();
    await userEvent.click(
      within(table).getByRole('button', { name: 'Collapse Issue 1' }),
    );
    expect(titles(table)).toEqual(['1', '2', '4']);
    await userEvent.click(
      within(table).getByRole('button', { name: 'Expand Issue 1' }),
    );
    expect(titles(table)).toEqual(['1', '5', '2', '4']);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(titles(table)).toEqual(['1', '2', '4']);
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(titles(table)).toEqual(['1', '5', '2', '4']);
  });

  it('shows the MIAC task status and opens the task from its row', async () => {
    fake();
    useStore.setState({ tasks: [task({})] });
    render(<Shell />);
    const table = await grid();
    const r = within(table).getAllByRole('row')[3];
    expect(within(r).getByText('Open')).toBeInTheDocument();
    expect(within(r).queryByRole('button', { name: /Start/ })).toBeNull();
    await userEvent.click(r);
    expect(useStore.getState().screen).toEqual({ kind: 'task' });
    expect(useStore.getState().selectedTaskId).toBe('t1');
  });

  it('opens the Done page for a finished task', async () => {
    fake();
    useStore.setState({
      tasks: [
        task({
          status: 'done',
          finishedAt: '2026-10-15T12:01:00.000Z',
        }),
      ],
    });
    render(<Shell />);
    const table = await grid();
    await userEvent.click(
      within(table).getByRole('button', {
        name: 'Open the task for Issue 2 Estimated delivery date',
      }),
    );
    expect(useStore.getState().screen).toEqual({ kind: 'task' });
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Estimated delivery date',
      }),
    ).toBeInTheDocument();
  });

  it('Start opens New task with the item and the first linked repo preselected', async () => {
    fake();
    useStore.setState({
      repos: [{ ...repo, id: 'r0', name: 'other', connectionId: null }, repo],
    });
    render(<Shell />);
    const table = await grid();
    await userEvent.click(
      within(table).getByRole('button', {
        name: 'Start a task for Task 5 Store the address',
      }),
    );
    expect(useStore.getState().screen).toEqual({
      kind: 'new-task',
      workItem: {
        id: '5',
        type: 'Task',
        title: 'Store the address',
        url: 'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/5',
      },
      repoId: 'r1',
    });
    expect(await screen.findByLabelText('Repo')).toHaveValue('r1');
    expect(screen.getByText('Task 5')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Branch')).toHaveValue(
        'feature/5-store-the-address',
      ),
    );
  });

  it('disables Start when no repo is linked to the project', async () => {
    fake();
    useStore.setState({ repos: [{ ...repo, connectionId: null }] });
    render(<Shell />);
    const table = await grid();
    expect(
      within(table).getByRole('button', {
        name: 'Start a task for Issue 2 Estimated delivery date',
      }),
    ).toBeDisabled();
  });

  it('asks to connect Azure DevOps when there is no connection', async () => {
    const { calls } = fake();
    useStore.setState({ connections: [], repos: [] });
    render(<Shell />);
    expect(
      screen.getByText(/Connect Azure DevOps in Settings/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Open Settings' }),
    );
    expect(useStore.getState().screen).toEqual({ kind: 'settings' });
    expect(calls.some((c) => c.channel === 'workItems:sprint')).toBe(false);
  });

  it('without a current sprint, says so and lists the work assigned to me', async () => {
    const { calls } = fake({
      'workItems:sprint': () => ({ iteration: null, rows: [] }),
      'workItems:search': () => [item(9, 'Bug', 'Mine to fix')],
    });
    render(<Shell />);
    expect(
      await screen.findByText('This project has no current sprint.'),
    ).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Assigned to me' });
    expect(within(table).getByText('Mine to fix')).toBeInTheDocument();
    expect(calls.find((c) => c.channel === 'workItems:search')?.args).toEqual([
      'c1',
      { scope: 'mine', text: '' },
    ]);
  });

  it('shows the error and retries', async () => {
    let fail = true;
    fake({
      'workItems:sprint': () => {
        if (fail) throw new Error('Azure DevOps did not answer within 15 s');
        return sprint;
      },
    });
    render(<Shell />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load the sprint: Azure DevOps did not answer within 15 s',
    );
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await grid()).toBeInTheDocument();
  });

  it('refreshes on the button and on window focus at most once a minute', async () => {
    const { calls } = fake();
    const now = vi.spyOn(Date, 'now');
    let t = 1_000_000;
    now.mockImplementation(() => t);
    render(<Shell />);
    await grid();
    const loads = () =>
      calls.filter((c) => c.channel === 'workItems:sprint').length;
    expect(loads()).toBe(1);
    t += 30_000;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(loads()).toBe(1);
    t += 31_000;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(loads()).toBe(2));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(loads()).toBe(3));
    now.mockRestore();
  });

  it('shows an empty sprint', async () => {
    fake({
      'workItems:sprint': () => ({ iteration: sprint.iteration, rows: [] }),
    });
    render(<Shell />);
    expect(
      await screen.findByText('No work items in this sprint.'),
    ).toBeInTheDocument();
  });
});

describe('visibleRows', () => {
  it('hides every row below a collapsed parent, at any depth', () => {
    const rows = [
      row(item(1, 'Epic', 'a'), 0, null, true),
      row(item(2, 'Feature', 'b'), 1, '1', true),
      row(item(3, 'Task', 'c'), 2, '2'),
      row(item(4, 'Task', 'd'), 1, '1'),
      row(item(5, 'Task', 'e')),
    ];
    const ids = (c: string[]) =>
      visibleRows(rows, new Set(c)).map((r) => r.item.id);
    expect(ids([])).toEqual(['1', '2', '3', '4', '5']);
    expect(ids(['2'])).toEqual(['1', '2', '4', '5']);
    expect(ids(['1'])).toEqual(['1', '5']);
  });
});
