import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskView } from '../shared/types';
import { useStore } from './store';
import { installFakeApi } from './test-helpers/fakeApi';
import { App, Shell } from './App';

vi.mock('./components/TerminalView', () => ({ TerminalView: () => null }));

const task: TaskView = {
  id: 'a',
  repoId: 'r1',
  name: '',
  workItem: { id: '48213', type: 'Bug', title: 'Broken checkout', url: null },
  slug: 'a',
  branch: 'bugfix/48213-broken-checkout',
  worktreePath: '/w/a',
  baseRef: 'origin/main',
  baseSha: null,
  status: 'ready',
  setup: {
    copy: false,
    commands: [],
    startClaude: false,
    openShell: false,
    openCopilot: false,
  },
  terminals: [],
  createdAt: 'now',
  finishedAt: null,
  worktreeMissing: false,
  usageSyncedAt: null,
  usageSyncError: null,
  usageCommentId: null,
  summary: null,
  pullRequest: null,
  closedTerminals: [],
  reopen: null,
  extraWorkspaces: [],
  detachedPaths: [],
  homeDropped: false,
  connectionId: null,
  mainCheckoutEdits: [],
};
const repo = {
  id: 'r1',
  name: 'webshop',
  path: '/src/webshop',
  baseBranch: 'main',
  connectionId: null,
  miacYmlFound: true,
  discovered: false,
  workItemOnStart: {
    moveToInProgress: true,
    assignToMe: true,
    stateOverrides: {},
  },
};

beforeEach(() =>
  useStore.setState({
    repos: [],
    tasks: [],
    connections: [],
    notices: [],
    selectedTaskId: null,
    previous: null,
    screen: { kind: 'sprint' },
  }),
);

/** A full-page screen renders in the content area next to the nav, never on top of it. */
function expectFullPage() {
  expect(document.querySelector('.overlay, .dialog')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  const content = screen.getByRole('main');
  expect(content).toHaveClass('content');
  expect(screen.getByRole('navigation', { name: 'Tasks' }).parentElement).toBe(
    content.parentElement,
  );
  return content;
}

describe('App', () => {
  it('loads repos and tasks on start and shows notices pushed from main', async () => {
    const { calls, emit } = installFakeApi();
    render(<App />);
    expect(screen.getByText('MIAC')).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.map((c) => c.channel).sort()).toEqual([
        'connections:list',
        'repos:list',
        'tasks:list',
        'update:status',
      ]),
    );
    emit('notice', { level: 'warn', message: 'state.json was unreadable' });
    expect(
      await screen.findByText('state.json was unreadable'),
    ).toBeInTheDocument();
  });

  it('lands on Sprint at startup without selecting a task', async () => {
    const { calls } = installFakeApi({
      'repos:list': () => [repo],
      'tasks:list': () => [task],
    });
    render(<App />);
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'tasks:list')).toBe(true),
    );
    expect(
      await screen.findByRole('button', { name: /Broken checkout/ }),
    ).not.toHaveAttribute('aria-current');
    expect(useStore.getState().selectedTaskId).toBeNull();
    expect(
      within(screen.getByRole('main')).getByRole('heading', {
        name: 'Sprint',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Connect Azure DevOps in Settings/),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Tasks' })).getByRole(
        'button',
        { name: 'Sprint', current: 'page' },
      ),
    ).toBeInTheDocument();
  });
});

describe('full pages', () => {
  it('renders New task as a page and Escape returns to the previous page', async () => {
    installFakeApi({
      'repos:config': () => ({
        worktreeRoot: '/src/webshop.worktrees',
        config: {
          base: 'main',
          branch: '{type}/{id}-{slug}',
          copy: [],
          setup: [],
          run: {},
          found: true,
        },
      }),
    });
    useStore.setState({ repos: [repo] });
    useStore.getState().go({ kind: 'settings' });
    render(<Shell />);
    await userEvent.click(screen.getByRole('button', { name: 'New task' }));
    const content = expectFullPage();
    expect(
      within(content).getByRole('heading', { name: 'New task' }),
    ).toBeInTheDocument();
    expect(within(content).getByRole('tab', { name: 'Typed' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(useStore.getState().screen).toEqual({ kind: 'settings' });
  });

  it('New task ignores Escape during an IME composition and inside a select', async () => {
    installFakeApi({
      'repos:config': () => ({
        worktreeRoot: '/src/webshop.worktrees',
        config: {
          base: 'main',
          branch: '{type}/{id}-{slug}',
          copy: [],
          setup: [],
          run: {},
          found: true,
        },
      }),
    });
    useStore.setState({ repos: [repo] });
    useStore.getState().go({ kind: 'new-task' });
    render(<Shell />);
    const content = expectFullPage();
    const input = within(content).getAllByRole('textbox')[0];
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(useStore.getState().screen.kind).toBe('new-task');
    fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 });
    expect(useStore.getState().screen.kind).toBe('new-task');
    const select = within(content).getAllByRole('combobox')[0];
    fireEvent.keyDown(select, { key: 'Escape' });
    expect(useStore.getState().screen.kind).toBe('new-task');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(useStore.getState().screen.kind).not.toBe('new-task');
  });

  it('renders Finish as a page and Keep task returns to the task', async () => {
    installFakeApi({
      'tasks:finishChecks': () => ({
        uncommitted: [],
        unpushed: 0,
        runningTerminals: 0,
      }),
    });
    useStore.setState({ repos: [repo], tasks: [task] });
    useStore.getState().openTask('a');
    useStore.getState().go({ kind: 'finish', taskId: 'a' });
    render(<Shell />);
    const content = expectFullPage();
    expect(
      within(content).getByRole('heading', { name: 'Finish task' }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByText(
        /Bug 48213 Broken checkout/,
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep task' }));
    expect(useStore.getState().screen).toEqual({ kind: 'task' });
  });
});
