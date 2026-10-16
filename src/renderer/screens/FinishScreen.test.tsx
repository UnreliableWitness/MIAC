import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TaskView } from '../../shared/types';
import { readPrChoice, writePrChoice } from '../uiPrefs';
import { useStore } from '../store';
import { emptyTime, emptyUsage, installFakeApi } from '../test-helpers/fakeApi';
import { FinishScreen } from './FinishScreen';

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
  worktreePath: '/w/a',
  baseRef: 'origin/main',
  baseSha: null,
  openPeriods: [],
  time: null,
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
  closedTerminals: [],
  reopen: null,
  worktreeMissing: false,
};
const dirty = {
  uncommitted: [
    { status: 'M', path: 'src/a.ts' },
    { status: '?', path: 'src/b.ts' },
  ],
  unpushed: 2,
  runningTerminals: 2,
};
const clean = { uncommitted: [], unpushed: 0, runningTerminals: 0 };

beforeEach(() => {
  localStorage.clear();
  useStore.setState({
    repos: [],
    tasks: [task],
    connections: [],
    notices: [],
    screen: { kind: 'finish', taskId: 'a' },
    selectedTaskId: 'a',
  });
});

describe('FinishScreen', () => {
  it('shows the safety checks and the cleanup options', async () => {
    installFakeApi({ 'tasks:finishChecks': () => dirty });
    render(<FinishScreen taskId="a" />);
    expect(
      await screen.findByText('2 uncommitted changes'),
    ).toBeInTheDocument();
    expect(screen.getByText(/M src\/a\.ts/)).toBeInTheDocument();
    expect(screen.getByText('2 commits not pushed')).toBeInTheDocument();
    expect(screen.getByText('2 terminals still running')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Close 2 terminals (Claude Code, zsh)'),
    ).toBeChecked();
    expect(screen.getByLabelText('Remove worktree folder')).toBeChecked();
    expect(screen.getByLabelText(/Delete local branch/)).toBeChecked();
    expect(
      screen.getByRole('button', { name: 'Discard changes and clean up' }),
    ).toBeInTheDocument();
  });

  it('shows green checks and a plain finish button when clean', async () => {
    installFakeApi({ 'tasks:finishChecks': () => clean });
    render(<FinishScreen taskId="a" />);
    expect(
      await screen.findByText('No uncommitted changes'),
    ).toBeInTheDocument();
    expect(screen.getByText('Nothing to push')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Finish and clean up' }),
    ).toBeInTheDocument();
  });

  it('finishes with the chosen options and shows the Done page', async () => {
    const { calls } = installFakeApi({
      'tasks:finishChecks': () => clean,
      'tasks:finish': () => undefined,
    });
    render(<FinishScreen taskId="a" />);
    await userEvent.click(await screen.findByLabelText(/Delete local branch/));
    await userEvent.click(
      screen.getByRole('button', { name: 'Finish and clean up' }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.channel === 'tasks:finish')?.args).toEqual([
        'a',
        {
          closeTerminals: true,
          removeWorktree: true,
          deleteBranch: false,
          syncUsage: false,
          createPullRequest: false,
          bookedSeconds: 0,
        },
      ]),
    );
    expect(useStore.getState().screen).toEqual({ kind: 'task' });
    expect(useStore.getState().selectedTaskId).toBe('a');
  });

  it('does not move the user to the Done page when they left the Finish page while it ran', async () => {
    let resolve: () => void = () => {};
    installFakeApi({
      'tasks:finishChecks': () => clean,
      'tasks:finish': () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    });
    useStore.setState({
      screen: { kind: 'finish', taskId: 'a' },
      previous: { kind: 'sprint' },
    });
    render(<FinishScreen taskId="a" />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Finish and clean up' }),
    );
    await userEvent.keyboard('{Escape}');
    useStore.getState().go({ kind: 'new-task' });
    resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(useStore.getState().screen).toEqual({ kind: 'new-task' });
  });

  it('opens commit and push in a terminal tab', async () => {
    const { calls } = installFakeApi({
      'tasks:finishChecks': () => dirty,
      'terminals:open': () => ({
        id: 'g1',
        kind: 'run',
        label: 'git commit',
        command: 'x',
      }),
    });
    render(<FinishScreen taskId="a" />);
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Commit' + String.fromCharCode(0x2026),
      }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.channel === 'terminals:open')?.args).toEqual([
        'a',
        {
          kind: 'run',
          label: 'git commit',
          command: 'git add -A && git commit',
        },
      ]),
    );
    expect(useStore.getState().screen).toEqual({ kind: 'task' });
    expect(useStore.getState().selectedTaskId).toBe('a');
  });

  it('stays open and shows the error when finishing fails', async () => {
    installFakeApi({
      'tasks:finishChecks': () => clean,
      'tasks:finish': () => {
        throw new Error('git worktree remove failed: locked');
      },
    });
    render(<FinishScreen taskId="a" />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Finish and clean up' }),
    );
    await waitFor(() =>
      expect(useStore.getState().notices[0]?.message).toMatch(/locked/),
    );
    expect(useStore.getState().screen).toEqual({ kind: 'finish', taskId: 'a' });
  });

  it('lets you clean up without checks when inspecting fails', async () => {
    const { calls } = installFakeApi({
      'tasks:finishChecks': () => {
        throw new Error('worktree gone');
      },
      'tasks:finish': () => undefined,
    });
    render(<FinishScreen taskId="a" />);
    expect(
      await screen.findByText(
        /Could not inspect the worktree: .*worktree gone/,
      ),
    ).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Clean up without checks' });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'tasks:finish')).toBe(true),
    );
  });

  it('does not fetch checks for a task that is not ready', async () => {
    useStore.setState({ tasks: [{ ...task, status: 'setup-failed' }] });
    const { calls } = installFakeApi({ 'tasks:finishChecks': () => clean });
    render(<FinishScreen taskId="a" />);
    expect(
      screen.getByText(
        /This task is setup-failed\. Finish it once setup has succeeded/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Keep task' }),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.channel === 'tasks:finishChecks')).toBe(false);
  });

  it('lists uncommitted files in a scrollable block', async () => {
    installFakeApi({
      'tasks:finishChecks': () => ({
        ...dirty,
        uncommitted: [
          { status: 'M', path: 'src/a.ts' },
          { status: 'M', path: 'src/b.ts' },
          { status: 'M', path: 'src/c.ts' },
        ],
      }),
    });
    render(<FinishScreen taskId="a" />);
    const el = await screen.findByText(/M src\/a\.ts/);
    expect(el).toHaveClass('files');
    expect(el.textContent).toContain('src/b.ts');
    expect(el.textContent).toContain('src/c.ts');
  });

  it('says that removing the folder closes the terminals anyway', async () => {
    installFakeApi({ 'tasks:finishChecks': () => clean });
    render(<FinishScreen taskId="a" />);
    const close = await screen.findByLabelText(
      'Close 2 terminals (Claude Code, zsh)',
    );
    const hint = /Removing the worktree folder closes its terminals too/;
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    await userEvent.click(close);
    expect(screen.getByText(hint)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Remove worktree folder'));
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
  });

  it('disables the terminal checkbox when there are no terminals', async () => {
    useStore.setState({ tasks: [{ ...task, terminals: [] }] });
    installFakeApi({ 'tasks:finishChecks': () => clean });
    render(<FinishScreen taskId="a" />);
    const box = await screen.findByLabelText('Close 0 terminals');
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
  });
});

describe('FinishScreen AI usage', () => {
  it('shows the total and sends syncUsage when ticked', async () => {
    useStore.setState({
      repos: [
        {
          id: task.repoId,
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
    });
    const { calls } = installFakeApi({
      'tasks:finishChecks': () => clean,
      'tasks:finish': () => undefined,
      'usage:task': (id) => ({
        ...emptyUsage(id),
        sessions: [{ sessionId: 's' } as never],
        billable: { costUsd: 10, costEur: 9.2, tokens: 5 },
        byTool: {
          'claude-code': { costUsd: 10, costEur: 9.2, sessions: 2, tokens: 5 },
          'copilot-cli': { costUsd: 0, costEur: 0, sessions: 0, tokens: 0 },
        },
      }),
    });
    render(<FinishScreen taskId={task.id} />);
    expect(
      await screen.findByText(/Claude Code .9\.20 over 2 sessions/),
    ).toBeTruthy();
    const box = screen.getByRole('checkbox', {
      name: /Write final totals to the work item/,
    });
    expect(box).toHaveProperty('checked', true);
    await userEvent.click(screen.getByRole('button', { name: /Finish/ }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.channel === 'tasks:finish')?.args[1],
      ).toMatchObject({ syncUsage: true }),
    );
  });
  it('leaves the checkbox unticked when no usage was captured, and still writes when ticked', async () => {
    useStore.setState({
      repos: [
        {
          id: task.repoId,
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
    });
    const { calls } = installFakeApi({
      'tasks:finishChecks': () => clean,
      'tasks:finish': () => undefined,
    });
    render(<FinishScreen taskId={task.id} />);
    await screen.findByText('No AI usage captured for this task.');
    const box = screen.getByRole('checkbox', {
      name: /Write final totals to the work item/,
    });
    await waitFor(() => expect(box).toHaveProperty('checked', false));
    await userEvent.click(box);
    expect(box).toHaveProperty('checked', true);
    await userEvent.click(screen.getByRole('button', { name: /Finish/ }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.channel === 'tasks:finish')?.args[1],
      ).toMatchObject({ syncUsage: true }),
    );
  });
  it('hides the checkbox when the repo has no connection', async () => {
    useStore.setState({
      repos: [
        {
          id: task.repoId,
          name: 'webshop',
          path: '/r',
          baseBranch: 'main',
          connectionId: null,
          miacYmlFound: true,
          workItemOnStart: {
            moveToInProgress: true,
            assignToMe: true,
            stateOverrides: {},
          },
        },
      ],
    });
    const { calls } = installFakeApi({
      'tasks:finishChecks': () => clean,
      'tasks:finish': () => undefined,
    });
    render(<FinishScreen taskId={task.id} />);
    await screen.findByText('AI usage');
    expect(
      screen.queryByRole('checkbox', { name: /Write final totals/ }),
    ).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Finish/ }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.channel === 'tasks:finish')?.args[1],
      ).toMatchObject({ syncUsage: false }),
    );
  });
  it('hides the checkbox and writes nothing when cost writing is off', async () => {
    useStore.setState({
      repos: [
        {
          id: task.repoId,
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
    });
    const { calls } = installFakeApi({
      'settings:get': () => ({
        version: 1,
        receiverPort: 4319,
        hourlySync: true,
        writeTimeToAdo: false,
        idleMinutes: 5,
        workHours: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
        writeCostToAdo: false,
        showSplash: true,
        sendTelemetry: true,
      }),
      'tasks:finishChecks': () => clean,
      'tasks:finish': () => undefined,
    });
    render(<FinishScreen taskId={task.id} />);
    await screen.findByText('AI usage');
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'settings:get')).toBe(true),
    );
    expect(
      screen.queryByRole('checkbox', { name: /Write final totals/ }),
    ).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Finish/ }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.channel === 'tasks:finish')?.args[1],
      ).toMatchObject({ syncUsage: false }),
    );
  });
});

describe('FinishScreen pull request', () => {
  const available = {
    'tasks:prAvailability': () => ({
      available: true,
      reason: null,
      target: 'main',
    }),
  };
  const label = 'Create a draft pull request into main';
  const finishArgs = (calls: { channel: string; args: unknown[] }[]) =>
    calls.filter((c) => c.channel === 'tasks:finish').map((c) => c.args[1]);

  it('starts unchecked on first use; ticking it sends true and remembers it', async () => {
    const { calls } = installFakeApi({
      ...available,
      'tasks:finishChecks': () => clean,
      'tasks:finish': () => undefined,
    });
    render(<FinishScreen taskId="a" />);
    const box = await screen.findByLabelText(label);
    await waitFor(() => expect(box).toBeEnabled());
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    expect(localStorage.length).toBe(0);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Finish and clean up' }),
    );
    await waitFor(() =>
      expect(finishArgs(calls)[0]).toMatchObject({ createPullRequest: true }),
    );
    expect(readPrChoice('r1')).toBe(true);
  });

  it('starts checked when the last choice for the repo was yes', async () => {
    writePrChoice('r1', true);
    installFakeApi({ ...available, 'tasks:finishChecks': () => clean });
    render(<FinishScreen taskId="a" />);
    await waitFor(() => expect(screen.getByLabelText(label)).toBeChecked());
  });

  it('is disabled and unchecked with the reason when unavailable, and saves nothing', async () => {
    writePrChoice('r1', true);
    const { calls } = installFakeApi({
      'tasks:prAvailability': () => ({
        available: false,
        reason: 'origin is not an Azure Repos URL',
        target: null,
      }),
      'tasks:finishChecks': () => clean,
      'tasks:finish': () => undefined,
    });
    render(<FinishScreen taskId="a" />);
    const box = await screen.findByLabelText(/^Create a draft pull request/);
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(
      await screen.findByText('origin is not an Azure Repos URL'),
    ).toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Finish and clean up' }),
    );
    await waitFor(() =>
      expect(finishArgs(calls)[0]).toMatchObject({ createPullRequest: false }),
    );
    expect(readPrChoice('r1')).toBe(true);
  });

  it('hides the unpushed warning only while the box is checked', async () => {
    installFakeApi({
      ...available,
      'tasks:finishChecks': () => ({ ...clean, unpushed: 2 }),
    });
    render(<FinishScreen taskId="a" />);
    const box = await screen.findByLabelText(label);
    expect(await screen.findByText('2 commits not pushed')).toBeInTheDocument();
    await userEvent.click(box);
    expect(screen.queryByText('2 commits not pushed')).toBeNull();
    await userEvent.click(box);
    expect(screen.getByText('2 commits not pushed')).toBeInTheDocument();
  });

  it('shows the failure with Retry and Finish without PR, staying on the page', async () => {
    const message =
      'Pull request not created: The token cannot create pull requests (needs Code: Read & write)';
    let n = 0;
    const { calls } = installFakeApi({
      ...available,
      'tasks:finishChecks': () => clean,
      'tasks:finish': () => {
        if (n++ < 2) throw new Error(message);
        return undefined;
      },
    });
    render(<FinishScreen taskId="a" />);
    await userEvent.click(await screen.findByLabelText(label));
    await userEvent.click(
      screen.getByRole('button', { name: 'Finish and clean up' }),
    );
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(useStore.getState().screen).toEqual({ kind: 'finish', taskId: 'a' });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(finishArgs(calls)).toHaveLength(2));
    expect(finishArgs(calls)[1]).toEqual(finishArgs(calls)[0]);
    await screen.findByText(message);
    await userEvent.click(
      screen.getByRole('button', { name: 'Finish without PR' }),
    );
    await waitFor(() => expect(finishArgs(calls)).toHaveLength(3));
    expect(finishArgs(calls)[2]).toMatchObject({ createPullRequest: false });
    await waitFor(() =>
      expect(useStore.getState().screen).toEqual({ kind: 'task' }),
    );
  });
});

describe('FinishScreen pull request failure with unpushed commits', () => {
  const available = {
    'tasks:prAvailability': () => ({
      available: true,
      reason: null,
      target: 'main',
    }),
  };
  const label = 'Create a draft pull request into main';
  const message =
    'Pull request not created: git push failed: could not read from remote';
  const finishArgs = (calls: { channel: string; args: unknown[] }[]) =>
    calls.filter((c) => c.channel === 'tasks:finish').map((c) => c.args[1]);
  const checkCalls = (calls: { channel: string }[]) =>
    calls.filter((c) => c.channel === 'tasks:finishChecks').length;

  it('Finish without PR does not delete unpushed commits until the user confirms the discard', async () => {
    let n = 0;
    const { calls } = installFakeApi({
      ...available,
      'tasks:finishChecks': () => ({ ...clean, unpushed: 3 }),
      'tasks:finish': () => {
        if (n++ === 0) throw new Error(message);
        return undefined;
      },
    });
    render(<FinishScreen taskId="a" />);
    await userEvent.click(await screen.findByLabelText(label));
    await userEvent.click(
      screen.getByRole('button', { name: 'Finish and clean up' }),
    );
    expect(await screen.findByText(message)).toBeInTheDocument();
    // The failure re-runs the checks: a push that went through changes the count.
    await waitFor(() => expect(checkCalls(calls)).toBe(2));
    await userEvent.click(
      screen.getByRole('button', { name: 'Finish without PR' }),
    );
    expect(finishArgs(calls)).toHaveLength(1);
    expect(screen.getByText('3 commits not pushed')).toBeInTheDocument();
    expect(screen.getByLabelText(label)).not.toBeChecked();
    expect(screen.queryByText(message)).toBeNull();
    const danger = screen.getByRole('button', {
      name: 'Discard changes and clean up',
    });
    expect(danger).toHaveClass('btn-danger');
    await userEvent.click(danger);
    await waitFor(() => expect(finishArgs(calls)).toHaveLength(2));
    expect(finishArgs(calls)[1]).toMatchObject({
      createPullRequest: false,
      deleteBranch: true,
    });
  });

  it('Finish without PR finishes directly when the push went through', async () => {
    let checks = 0;
    let n = 0;
    const { calls } = installFakeApi({
      ...available,
      'tasks:finishChecks': () => ({ ...clean, unpushed: checks++ ? 0 : 3 }),
      'tasks:finish': () => {
        if (n++ === 0)
          throw new Error(
            'Pull request not created: Azure DevOps is unreachable',
          );
        return undefined;
      },
    });
    render(<FinishScreen taskId="a" />);
    await userEvent.click(await screen.findByLabelText(label));
    await userEvent.click(
      screen.getByRole('button', { name: 'Finish and clean up' }),
    );
    await screen.findByText(/Azure DevOps is unreachable/);
    await waitFor(() => expect(checkCalls(calls)).toBe(2));
    await userEvent.click(
      screen.getByRole('button', { name: 'Finish without PR' }),
    );
    await waitFor(() => expect(finishArgs(calls)).toHaveLength(2));
    expect(finishArgs(calls)[1]).toMatchObject({ createPullRequest: false });
  });

  it('unticking the box clears the stale error, so Retry cannot run a plain finish', async () => {
    const { calls } = installFakeApi({
      ...available,
      'tasks:finishChecks': () => ({ ...clean, unpushed: 3 }),
      'tasks:finish': () => {
        throw new Error(message);
      },
    });
    render(<FinishScreen taskId="a" />);
    const box = await screen.findByLabelText(label);
    await userEvent.click(box);
    await userEvent.click(
      screen.getByRole('button', { name: 'Finish and clean up' }),
    );
    await screen.findByText(message);
    await waitFor(() => expect(checkCalls(calls)).toBe(2));
    await userEvent.click(box);
    expect(screen.queryByText(message)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Discard changes and clean up' }),
    ).toHaveClass('btn-danger');
    expect(finishArgs(calls)).toHaveLength(1);
  });

  it('keeps Finish disabled until pull request availability has loaded', async () => {
    writePrChoice('r1', true);
    let resolve: (v: {
      available: boolean;
      reason: string | null;
      target: string | null;
    }) => void = () => {};
    const { calls } = installFakeApi({
      'tasks:prAvailability': () =>
        new Promise((r) => {
          resolve = r;
        }),
      'tasks:finishChecks': () => clean,
      'tasks:finish': () => undefined,
    });
    render(<FinishScreen taskId="a" />);
    const btn = await screen.findByRole('button', {
      name: 'Finish and clean up',
    });
    await screen.findByText('Nothing to push');
    expect(btn).toBeDisabled();
    resolve({ available: true, reason: null, target: 'main' });
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);
    await waitFor(() =>
      expect(finishArgs(calls)[0]).toMatchObject({ createPullRequest: true }),
    );
  });

  it('enables Finish when pull request availability fails to load', async () => {
    installFakeApi({
      'tasks:prAvailability': () => {
        throw new Error('boom');
      },
      'tasks:finishChecks': () => clean,
    });
    render(<FinishScreen taskId="a" />);
    const btn = await screen.findByRole('button', {
      name: 'Finish and clean up',
    });
    await waitFor(() => expect(btn).toBeEnabled());
  });

  describe('time spent', () => {
    const measured = {
      ...emptyTime('a'),
      activeSeconds: 11400,
      realisticSeconds: 14700,
      wallClockSeconds: 34200,
    };

    it('books the time in the field with Finish', async () => {
      const { calls } = installFakeApi({
        'tasks:finishChecks': () => clean,
        'tasks:finish': () => undefined,
        'time:task': () => measured,
      });
      render(<FinishScreen taskId="a" />);
      const field = await screen.findByLabelText('Time to book');
      expect(field).toHaveValue('3h 10m');
      await userEvent.clear(field);
      await userEvent.type(field, '4h');
      await userEvent.click(
        await screen.findByRole('button', { name: 'Finish and clean up' }),
      );
      await waitFor(() =>
        expect(calls.find((c) => c.channel === 'tasks:finish')).toBeDefined(),
      );
      const opts = calls.find((c) => c.channel === 'tasks:finish')?.args[1] as
        | { bookedSeconds?: number }
        | undefined;
      expect(opts?.bookedSeconds).toBe(14400);
    });

    it('starts from the earlier booking plus time measured since the reopen', async () => {
      installFakeApi({
        'tasks:finishChecks': () => clean,
        'time:task': () => ({
          ...measured,
          measuredSinceReopenSeconds: 1800,
          booking: {
            bookedSeconds: 7200,
            measuredSeconds: 7200,
            realisticSeconds: 7200,
            wallClockSeconds: 7200,
            agentSeconds: { 'claude-code': 0, 'copilot-cli': 0, opencode: 0 },
            bookedAt: 'then',
            writtenHours: 0,
            syncError: null,
          },
        }),
      });
      render(<FinishScreen taskId="a" />);
      expect(await screen.findByLabelText('Time to book')).toHaveValue(
        '2h 30m',
      );
    });

    it('invalid time blocks finish', async () => {
      installFakeApi({
        'tasks:finishChecks': () => clean,
        'time:task': () => measured,
      });
      render(<FinishScreen taskId="a" />);
      const field = await screen.findByLabelText('Time to book');
      await userEvent.clear(field);
      await userEvent.type(field, 'abc');
      expect(
        screen.getByText('Enter a time like 3h 30m or 3.5'),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole('button', { name: 'Finish and clean up' }),
      ).toBeDisabled();
    });

    it('uses the live original estimate from the work item', async () => {
      useStore.setState({
        repos: [
          {
            id: 'r1',
            name: 'repo',
            path: '/src/repo',
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
      });
      installFakeApi({
        'tasks:finishChecks': () => clean,
        'time:task': () => ({
          ...measured,
          estimate: { hours: 8, source: 'baseline' },
        }),
        'workItems:get': () => ({
          id: '48213',
          type: 'User Story',
          title: 't',
          state: 'Active',
          areaPath: 'a',
          iterationPath: 'i',
          assignedTo: null,
          url: 'u',
          originalEstimate: 5,
          remainingWork: 1,
          completedWork: 2,
        }),
      });
      render(<FinishScreen taskId="a" />);
      expect(
        await screen.findByText('3h 10m of 5h estimate'),
      ).toBeInTheDocument();
    });

    it('falls back to the recorded estimate without a connection', async () => {
      installFakeApi({
        'tasks:finishChecks': () => clean,
        'time:task': () => ({
          ...measured,
          estimate: { hours: 8, source: 'baseline' },
        }),
      });
      render(<FinishScreen taskId="a" />);
      expect(
        await screen.findByText('3h 10m of 8h estimate'),
      ).toBeInTheDocument();
    });
  });

  describe('time loading', () => {
    const measured = { ...emptyTime('a'), activeSeconds: 11400 };
    const finishOpts = (calls: { channel: string; args: unknown[] }[]) =>
      calls.find((c) => c.channel === 'tasks:finish')?.args[1] as
        | Record<string, unknown>
        | undefined;

    it('disables Finish while the time is loading', async () => {
      installFakeApi({
        'tasks:finishChecks': () => clean,
        'time:task': () => new Promise(() => undefined),
      });
      render(<FinishScreen taskId="a" />);
      expect(await screen.findByText('Loading time\u2026')).toBeInTheDocument();
      await screen.findByText('Nothing to push');
      expect(
        screen.getByRole('button', { name: 'Finish and clean up' }),
      ).toBeDisabled();
    });

    it('offers Retry and Finish without booking time when loading fails', async () => {
      let fail = true;
      installFakeApi({
        'tasks:finishChecks': () => clean,
        'tasks:finish': () => undefined,
        'time:task': () => {
          if (fail) throw new Error('boom');
          return measured;
        },
      });
      render(<FinishScreen taskId="a" />);
      expect(
        await screen.findByText('Time could not be loaded'),
      ).toBeInTheDocument();
      await screen.findByText('Nothing to push');
      expect(
        screen.getByRole('button', { name: 'Finish and clean up' }),
      ).toBeDisabled();
      fail = false;
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByLabelText('Time to book')).toHaveValue(
        '3h 10m',
      );
    });

    it('finishes without bookedSeconds via Finish without booking time', async () => {
      const { calls } = installFakeApi({
        'tasks:finishChecks': () => clean,
        'tasks:finish': () => undefined,
        'time:task': () => {
          throw new Error('boom');
        },
      });
      render(<FinishScreen taskId="a" />);
      await screen.findByText('Nothing to push');
      await userEvent.click(
        await screen.findByRole('button', {
          name: 'Finish without booking time',
        }),
      );
      await waitFor(() => expect(finishOpts(calls)).toBeDefined());
      expect(finishOpts(calls)).not.toHaveProperty('bookedSeconds');
    });

    it('keeps the starting value when time changes while the page is open', async () => {
      let active = 11400;
      const { calls, emit } = installFakeApi({
        'tasks:finishChecks': () => clean,
        'tasks:finish': () => undefined,
        'time:task': () => ({ ...measured, activeSeconds: active }),
      });
      render(<FinishScreen taskId="a" />);
      expect(await screen.findByLabelText('Time to book')).toHaveValue(
        '3h 10m',
      );
      active = 12000;
      emit('time:changed', { taskId: 'a' });
      await waitFor(() =>
        expect(
          calls.filter((c) => c.channel === 'time:task').length,
        ).toBeGreaterThan(1),
      );
      await screen.findByText('Nothing to push');
      expect(screen.getByLabelText('Time to book')).toHaveValue('3h 10m');
      await userEvent.click(
        screen.getByRole('button', { name: 'Finish and clean up' }),
      );
      await waitFor(() => expect(finishOpts(calls)).toBeDefined());
      expect(finishOpts(calls)?.bookedSeconds).toBe(11400);
    });
  });
});
