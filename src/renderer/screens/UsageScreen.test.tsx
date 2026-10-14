import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskView } from '../../shared/types';
import type { TaskUsage } from '../../shared/usage';
import { useStore } from '../store';
import { emptyUsage, installFakeApi } from '../test-helpers/fakeApi';
import { UsageScreen } from './UsageScreen';

const EURO = String.fromCharCode(0x20ac);
const task: TaskView = {
  id: 't1',
  repoId: 'r1',
  name: '',
  workItem: {
    id: '48213',
    type: 'Issue',
    title: 'Checkout: allow saving a delivery address',
    url: null,
  },
  slug: 's',
  branch: 'feature/48213-save-delivery-address',
  worktreePath: '/w',
  baseRef: 'origin/main',
  status: 'ready',
  setup: {
    copy: false,
    commands: [],
    startClaude: true,
    openShell: true,
    openCopilot: false,
  },
  terminals: [],
  createdAt: 'now',
  finishedAt: null,
  worktreeMissing: false,
  usageSyncedAt: null,
  usageSyncError: null,
  usageCommentId: null,
};
const usage: TaskUsage = {
  ...emptyUsage('t1'),
  sessions: [
    {
      sessionId: 's1',
      tool: 'claude-code',
      startedAt: '2026-10-14T09:12:00.000Z',
      models: ['claude-opus-5-5'],
      requests: 3,
      inputTokens: 412_000,
      outputTokens: 96_000,
      cacheReadTokens: 3_100_000,
      cacheWriteTokens: 0,
      costUsd: 10,
      unpricedRequests: 0,
      billable: true,
    },
    {
      sessionId: 's2',
      tool: 'copilot-cli',
      startedAt: '2026-10-14T10:00:00.000Z',
      models: ['mystery-1'],
      requests: 1,
      inputTokens: 1000,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      unpricedRequests: 1,
      billable: true,
    },
  ],
  unpricedRequests: 1,
  billable: { costUsd: 10, costEur: 9.2, tokens: 3_609_010 },
  byTool: {
    'claude-code': {
      costUsd: 10,
      costEur: 9.2,
      sessions: 1,
      tokens: 3_608_000,
    },
    'copilot-cli': { costUsd: 0, costEur: 0, sessions: 1, tokens: 1010 },
  },
};

beforeEach(() => {
  useStore.setState({
    screen: { kind: 'usage', taskId: 't1' },
    tasks: [task],
    notices: [],
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
    connections: [
      {
        id: 'c1',
        name: 'unreliablewitness',
        organizationUrl: 'https://dev.azure.com/unreliablewitness',
        project: 'MIAC',
        user: 'Dries',
        status: 'ok',
        checkedAt: null,
      },
    ],
  });
});

describe('UsageScreen', () => {
  it('shows tiles, sessions, unpriced usage, field values and the comment preview', async () => {
    installFakeApi({
      'usage:task': () => usage,
      'usage:fieldsStatus': () => ({
        connectionId: 'c1',
        types: [
          {
            type: 'Issue',
            present: ['Custom.AICost', 'Custom.AITokens'],
            missing: ['Custom.AICostClaude', 'Custom.AICostCopilot'],
          },
        ],
      }),
    });
    render(<UsageScreen taskId="t1" />);
    expect(await screen.findByText('Billable AI cost')).toBeTruthy();
    expect(screen.getAllByText(`${EURO}9.20`).length).toBeGreaterThan(0);
    expect(screen.getByText(/USD to EUR 0.92 .* no markup/)).toBeTruthy();
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('claude-opus-5-5')).toBeTruthy();
    expect(within(rows[2]).getByText('unpriced')).toBeTruthy();
    expect(
      screen.getByText(/1 request uses a model that is not in the rate table/),
    ).toBeTruthy();
    expect(screen.getByText('3,609,010')).toBeTruthy();
    expect(await screen.findAllByText('not on Issue')).toHaveLength(2);
    expect(
      screen.getByText(/AI usage for this work item \(MIAC\)/),
    ).toBeTruthy();
  });
  it('toggles billable, syncs and exports', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      () => undefined,
    );
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const { calls } = installFakeApi({
      'usage:task': () => usage,
      'usage:fieldsStatus': () => ({ connectionId: 'c1', types: [] }),
      'usage:setBillable': () => ({
        ...usage,
        sessions: usage.sessions.map((s) =>
          s.sessionId === 's1' ? { ...s, billable: false } : s,
        ),
      }),
      'usage:sync': () => ({
        ok: false,
        fieldsWritten: [],
        fieldsMissing: [],
        commentPosted: false,
        error: 'boom',
      }),
      'usage:exportCsv': () => 'time\r\n',
    });
    render(<UsageScreen taskId="t1" />);
    const boxes = await screen.findAllByRole('checkbox', { name: /Billable/ });
    await userEvent.click(boxes[0]);
    expect(calls.find((c) => c.channel === 'usage:setBillable')?.args).toEqual([
      't1',
      's1',
      false,
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    await waitFor(() =>
      expect(
        useStore.getState().notices.some((n) => n.message.includes('boom')),
      ).toBe(true),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  });
  it('explains an empty task and a task without a connection', async () => {
    useStore.setState({
      repos: [
        {
          id: 'r1',
          name: 'webshop',
          path: '/r',
          baseBranch: 'main',
          connectionId: null,
          miacYmlFound: true,
        },
      ],
    });
    installFakeApi();
    render(<UsageScreen taskId="t1" />);
    expect(
      await screen.findByText(/No AI usage captured for this task yet/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sync now' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(
      screen.getByText(/Link the repository to an Azure DevOps connection/),
    ).toBeTruthy();
  });
  it('goes back to the workspace from a done task', async () => {
    useStore.setState({
      tasks: [{ ...task, status: 'done', finishedAt: '2026-10-14T12:00:00Z' }],
    });
    installFakeApi({ 'usage:task': () => usage });
    render(<UsageScreen taskId="t1" />);
    await screen.findByText('Billable AI cost');
    await userEvent.click(screen.getByText('Back to task'));
    expect(useStore.getState().screen).toEqual({ kind: 'workspace' });
  });
  it('says the task was not found and still offers Back', async () => {
    useStore.setState({ tasks: [] });
    installFakeApi();
    render(<UsageScreen taskId="gone" />);
    expect(screen.getByText('Task not found')).toBeTruthy();
    await userEvent.click(screen.getByText('Back to task'));
    expect(useStore.getState().screen).toEqual({ kind: 'workspace' });
  });
});
