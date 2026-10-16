import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Repo } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { NewTaskScreen } from './NewTaskScreen';

const webshop: Repo = {
  id: 'r1',
  name: 'webshop',
  path: '/src/webshop',
  baseBranch: 'main',
  connectionId: null,
  miacYmlFound: true,
  workItemOnStart: {
    moveToInProgress: true,
    assignToMe: true,
    stateOverrides: {},
  },
};
const config = {
  worktreeRoot: '/src/webshop.worktrees',
  config: {
    base: 'main',
    branch: '{type}/{id}-{slug}',
    copy: ['.env', '.env.local'],
    setup: ['npm ci', 'npm run build'],
    run: {},
    found: true,
  },
};

beforeEach(() =>
  useStore.setState({
    repos: [webshop],
    tasks: [],
    connections: [],
    notices: [],
    screen: { kind: 'new-task' },
  }),
);

describe('NewTaskScreen', () => {
  it('prefills branch and folder from the work item and the repo template', async () => {
    installFakeApi({ 'repos:config': () => config });
    render(<NewTaskScreen />);
    await userEvent.type(screen.getByLabelText('Work item id'), '48231');
    await userEvent.type(
      screen.getByLabelText('Title'),
      'Show estimated delivery date on product page',
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Branch')).toHaveValue(
        'feature/48231-show-estimated-delivery-date-on-product',
      ),
    );
    expect(
      screen.getByText(
        '/src/webshop.worktrees/48231-show-estimated-delivery-date-on-product',
      ),
    ).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'Bug');
    expect(screen.getByLabelText('Branch')).toHaveValue(
      'bugfix/48231-show-estimated-delivery-date-on-product',
    );
  });

  it('keeps a branch the user edited by hand', async () => {
    installFakeApi({ 'repos:config': () => config });
    render(<NewTaskScreen />);
    await userEvent.type(screen.getByLabelText('Title'), 'One');
    await userEvent.clear(screen.getByLabelText('Branch'));
    await userEvent.type(screen.getByLabelText('Branch'), 'custom/x');
    await userEvent.type(screen.getByLabelText('Title'), ' two');
    expect(screen.getByLabelText('Branch')).toHaveValue('custom/x');
  });

  it('uses the task name for a blank task', async () => {
    installFakeApi({ 'repos:config': () => config });
    render(<NewTaskScreen />);
    await userEvent.click(screen.getByRole('tab', { name: 'Blank' }));
    await userEvent.type(
      screen.getByLabelText('Task name'),
      'Spike new search',
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Branch')).toHaveValue(
        'feature/spike-new-search',
      ),
    );
  });

  it('creates the task with the chosen options and opens the setup screen', async () => {
    const { calls } = installFakeApi({
      'repos:config': () => config,
      'tasks:create': () => ({ id: 't1' }) as never,
    });
    render(<NewTaskScreen />);
    await userEvent.type(screen.getByLabelText('Work item id'), '48231');
    await userEvent.type(screen.getByLabelText('Title'), 'Delivery date');
    await waitFor(() =>
      expect(screen.getByLabelText('npm run build')).toBeChecked(),
    );
    await userEvent.click(screen.getByLabelText('npm run build'));
    await userEvent.click(screen.getByLabelText('Open a shell tab'));
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() =>
      expect(useStore.getState().screen).toEqual({
        kind: 'setup',
        taskId: 't1',
      }),
    );
    const create = calls.find((c) => c.channel === 'tasks:create');
    expect(create?.args[0]).toEqual({
      repoId: 'r1',
      baseRef: 'origin/main',
      name: '',
      workItem: {
        id: '48231',
        type: 'User Story',
        title: 'Delivery date',
        url: null,
      },
      branch: 'feature/48231-delivery-date',
      copy: true,
      commands: ['npm ci'],
      startClaude: true,
      openShell: false,
      openCopilot: false,
    });
  });

  it('starts Copilot CLI with the task when ticked', async () => {
    const { calls } = installFakeApi({
      'repos:config': () => config,
      'tasks:create': () => ({ id: 't1' }) as never,
    });
    render(<NewTaskScreen />);
    await userEvent.type(screen.getByLabelText('Work item id'), '48231');
    await userEvent.type(screen.getByLabelText('Title'), 'Delivery date');
    const box = screen.getByLabelText('Start Copilot CLI with the task');
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.channel === 'tasks:create')?.args[0],
      ).toMatchObject({ openCopilot: true }),
    );
  });

  it('shows the error and stays open when create fails', async () => {
    installFakeApi({
      'repos:config': () => config,
      'tasks:create': () => {
        throw new Error('Branch feature/x already exists in webshop');
      },
    });
    render(<NewTaskScreen />);
    await userEvent.type(screen.getByLabelText('Work item id'), '48231');
    await userEvent.type(screen.getByLabelText('Title'), 'x');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create task' })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() =>
      expect(useStore.getState().notices[0]?.message).toMatch(/already exists/),
    );
    expect(useStore.getState().screen).toEqual({ kind: 'new-task' });
  });

  it('requires both id and title in work-item mode', async () => {
    installFakeApi({ 'repos:config': () => config });
    render(<NewTaskScreen />);
    await userEvent.type(screen.getByLabelText('Title'), 'Only a title');
    await waitFor(() =>
      expect(screen.getByLabelText('npm run build')).toBeChecked(),
    );
    expect(screen.getByRole('button', { name: 'Create task' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Work item id'), '48231');
    expect(screen.getByRole('button', { name: 'Create task' })).toBeEnabled();
  });

  it('preselects the work item and repo it was opened with', async () => {
    const { calls } = installFakeApi({
      'repos:config': () => config,
      'workItems:currentIteration': () => ({
        path: 'MIAC\\Sprint 1',
        name: 'Sprint 1',
      }),
      'workItems:search': () => [],
      'tasks:create': () => ({ id: 't9' }) as never,
    });
    const linked = { ...webshop, id: 'r2', name: 'api', connectionId: 'c1' };
    useStore.setState({
      repos: [webshop, linked],
      connections: [
        {
          id: 'c1',
          name: 'uw',
          organizationUrl: 'https://dev.azure.com/unreliablewitness',
          project: 'MIAC',
          user: 'D',
          status: 'ok',
          checkedAt: null,
          userUniqueName: null,
        },
      ],
    });
    const workItem = {
      id: '12',
      type: 'Bug',
      title: 'Broken checkout',
      url: 'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/12',
    };
    render(<NewTaskScreen initial={{ workItem, repoId: 'r2' }} />);
    expect(screen.getByLabelText('Repo')).toHaveValue('r2');
    expect(screen.getByRole('tab', { name: 'Work item' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Branch')).toHaveValue(
        'bugfix/12-broken-checkout',
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.channel === 'tasks:create')?.args[0],
      ).toMatchObject({ repoId: 'r2', workItem }),
    );
  });

  it('returns to the previous page on Cancel', async () => {
    installFakeApi({ 'repos:config': () => config });
    useStore.setState({ screen: { kind: 'settings' }, previous: null });
    useStore.getState().go({ kind: 'new-task' });
    render(<NewTaskScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useStore.getState().screen).toEqual({ kind: 'settings' });
  });

  it('creates a task from a picked work item when the repo has a connection', async () => {
    const { calls } = installFakeApi({
      'repos:config': () => config,
      'workItems:currentIteration': () => ({
        path: 'MIAC\\Sprint 1',
        name: 'Sprint 1',
      }),
      'workItems:search': () => [
        {
          id: '12',
          type: 'Issue',
          title: 'Save delivery address',
          state: 'To Do',
          areaPath: 'MIAC',
          iterationPath: 'MIAC\\Sprint 1',
          assignedTo: null,
          url: 'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/12',
        },
      ],
      'tasks:create': () => ({ id: 't9' }) as never,
    });
    useStore.setState({
      repos: [{ ...webshop, connectionId: 'c1' }],
      connections: [
        {
          id: 'c1',
          name: 'uw',
          organizationUrl: 'https://dev.azure.com/unreliablewitness',
          project: 'MIAC',
          user: 'D',
          status: 'ok',
          checkedAt: null,
          userUniqueName: null,
        },
      ],
    });
    render(<NewTaskScreen />);
    await userEvent.click(
      await screen.findByRole('button', { name: /Save delivery address/ }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Branch')).toHaveValue(
        'feature/12-save-delivery-address',
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.channel === 'tasks:create')?.args[0],
      ).toMatchObject({
        workItem: {
          id: '12',
          type: 'Issue',
          title: 'Save delivery address',
          url: 'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/12',
        },
      }),
    );
  });

  const conn = {
    id: 'c1',
    name: 'uw',
    organizationUrl: 'https://dev.azure.com/unreliablewitness',
    project: 'MIAC',
    user: 'D',
    status: 'ok' as const,
    checkedAt: null,
    userUniqueName: null,
  };
  const pickerApi = {
    'repos:config': () => config,
    'workItems:currentIteration': () => ({ path: 'p', name: 'S' }),
    'workItems:search': () => [],
  };

  it('follows the selected repo between picker and typed form', async () => {
    installFakeApi(pickerApi);
    useStore.setState({
      repos: [
        { ...webshop, connectionId: 'c1' },
        { ...webshop, id: 'r2', name: 'plain' },
      ],
      connections: [conn],
    });
    render(<NewTaskScreen />);
    expect(
      await screen.findByLabelText('Search work items'),
    ).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Repo'), 'plain');
    expect(await screen.findByLabelText('Work item id')).toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'Work item' }),
    ).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Repo'), 'webshop');
    expect(
      await screen.findByLabelText('Search work items'),
    ).toBeInTheDocument();
  });

  it('falls back to the typed form when the repo loses its connection', async () => {
    installFakeApi(pickerApi);
    useStore.setState({
      repos: [{ ...webshop, connectionId: 'c1' }],
      connections: [conn],
    });
    render(<NewTaskScreen />);
    expect(
      await screen.findByLabelText('Search work items'),
    ).toBeInTheDocument();
    act(() =>
      useStore.setState({ repos: [{ ...webshop, connectionId: null }] }),
    );
    expect(await screen.findByLabelText('Work item id')).toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'Work item' }),
    ).not.toBeInTheDocument();
  });

  it('clears the picked item when the repo switches to another connection', async () => {
    installFakeApi({
      ...pickerApi,
      'workItems:search': () => [
        {
          id: '12',
          type: 'Issue',
          title: 'Save delivery address',
          state: 'To Do',
          areaPath: 'MIAC',
          iterationPath: 'p',
          assignedTo: null,
          url: 'https://dev.azure.com/o/p/_workitems/edit/12',
        },
      ],
    });
    useStore.setState({
      repos: [{ ...webshop, connectionId: 'c1' }],
      connections: [conn, { ...conn, id: 'c2', name: 'other' }],
    });
    render(<NewTaskScreen />);
    await userEvent.click(
      await screen.findByRole('button', { name: /Save delivery address/ }),
    );
    const create = screen.getByRole('button', { name: 'Create task' });
    await waitFor(() => expect(create).toBeEnabled());
    act(() =>
      useStore.setState({ repos: [{ ...webshop, connectionId: 'c2' }] }),
    );
    await waitFor(() => expect(create).toBeDisabled());
    await userEvent.click(
      await screen.findByRole('button', { name: /Save delivery address/ }),
    );
    await waitFor(() => expect(create).toBeEnabled());
  });
});
