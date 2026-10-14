import { render, screen, waitFor } from '@testing-library/react';
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
    await userEvent.click(screen.getByRole('tab', { name: 'Blank task' }));
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
    });
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
});
