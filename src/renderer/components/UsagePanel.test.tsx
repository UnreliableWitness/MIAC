import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskView } from '../../shared/types';
import type { TaskUsage } from '../../shared/usage';
import { useStore } from '../store';
import { emptyUsage, installFakeApi } from '../test-helpers/fakeApi';
import { UsagePanel } from './UsagePanel';

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
  baseSha: null,
  openPeriods: [],
  time: null,
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
const usage: TaskUsage = {
  ...emptyUsage('t1'),
  sessions: [
    {
      sessionId: 's1',
      tool: 'claude-code',
      startedAt: '2026-10-14T09:12:00.000Z',
      lastAt: '2026-10-14T09:12:00.000Z',
      models: ['claude-opus-5-5'],
      requests: 3,
      inputTokens: 412_000,
      outputTokens: 96_000,
      cacheReadTokens: 3_100_000,
      cacheWriteTokens: 250_000,
      costUsd: 10,
      unpricedRequests: 0,
      billable: true,
    },
    {
      sessionId: 's2',
      tool: 'copilot-cli',
      startedAt: '2026-10-14T10:00:00.000Z',
      lastAt: '2026-10-14T10:00:00.000Z',
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
    tasks: [task],
    notices: [],
    repos: [
      {
        id: 'r1',
        name: 'webshop',
        path: '/r',
        baseBranch: 'main',
        connectionId: 'c1',
        configFound: true,
        discovered: false,
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
        project: 'Shellie',
        user: 'Dries',
        status: 'ok',
        checkedAt: null,
        userUniqueName: null,
      },
    ],
  });
});

describe('UsagePanel', () => {
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
    render(<UsagePanel taskId="t1" />);
    expect(await screen.findByRole('img', { name: /Billable/ })).toBeTruthy();
    expect(screen.getAllByText(`${EURO}9.20`).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Official list prices .* USD\S+EUR 0.92/),
    ).toBeTruthy();
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('claude-opus-5-5')).toBeTruthy();
    expect(within(rows[1]).getByText(`${EURO}9.20`)).toBeTruthy();
    expect(within(rows[1]).getByText('3.9M')).toBeTruthy();
    expect(screen.getByText('3.6M tokens')).toBeTruthy();
    expect(within(rows[2]).getByText('unpriced')).toBeTruthy();
    expect(
      screen.getByText(
        /1 request uses a model that is not in Shellie's official price list yet/,
      ),
    ).toBeTruthy();
    expect(screen.getByText('3,609,010')).toBeTruthy();
    expect(await screen.findAllByText('not on Issue')).toHaveLength(2);
    expect(
      screen.getByText(/AI usage for this work item \(Shellie\)/),
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
    render(<UsagePanel taskId="t1" />);
    const boxes = await screen.findAllByRole('checkbox', { name: /Billable/ });
    await userEvent.click(boxes[0]);
    expect(calls.find((c) => c.channel === 'usage:setBillable')?.args).toEqual([
      't1',
      's1',
      false,
    ]);
    await userEvent.click(
      screen.getByRole('button', { name: 'Write to work item' }),
    );
    await waitFor(() =>
      expect(
        useStore.getState().notices.some((n) => n.message.includes('boom')),
      ).toBe(true),
    );
    await userEvent.click(screen.getByRole('button', { name: 'CSV' }));
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
          configFound: true,
          discovered: false,
          workItemOnStart: {
            moveToInProgress: true,
            assignToMe: true,
            stateOverrides: {},
          },
        },
      ],
    });
    installFakeApi();
    render(<UsagePanel taskId="t1" />);
    expect(
      await screen.findByText(/No AI usage captured for this task yet/),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Write to work item' }),
    ).toHaveProperty('disabled', true);
    expect(
      screen.getByText(/Link the repository to an Azure DevOps connection/),
    ).toBeTruthy();
  });
  it('says cost writing is off and offers only the CSV', async () => {
    const { calls } = installFakeApi({
      'usage:task': () => usage,
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
        editor: { default: null, repos: {} },
      }),
    });
    render(<UsagePanel taskId="t1" />);
    expect(
      await screen.findByText(/Writing AI cost to Azure DevOps is off/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Write to work item' }),
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'CSV' })).toBeInTheDocument();
    expect(calls.some((c) => c.channel === 'usage:fieldsStatus')).toBe(false);
  });

  it('says the task was not found', () => {
    useStore.setState({ tasks: [] });
    installFakeApi();
    render(<UsagePanel taskId="gone" />);
    expect(screen.getByText('Task not found')).toBeTruthy();
  });
  it('splits the billable ring by tool and shows the total', async () => {
    installFakeApi({ 'usage:task': () => usage });
    render(<UsagePanel taskId="t1" />);
    const ring = await screen.findByRole('img', { name: /Billable .*9\.20/ });
    expect(ring.querySelectorAll('[data-part="segment"]')).toHaveLength(2);
  });
  it('marks a session with an event in the last 5 minutes as LIVE', async () => {
    const now = Date.parse('2026-10-14T10:03:00.000Z');
    installFakeApi({
      'usage:task': () => ({
        ...usage,
        sessions: usage.sessions.map((s, i) => ({
          ...s,
          lastAt: i === 1 ? '2026-10-14T10:00:00.000Z' : s.startedAt,
        })),
      }),
    });
    render(<UsagePanel taskId="t1" now={() => now} />);
    const rows = await screen.findAllByRole('row');
    expect(rows.filter((r) => r.textContent?.includes('LIVE'))).toHaveLength(1);
  });
  it('drops LIVE once 5 minutes pass without new usage', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let clock = Date.parse('2026-10-14T10:03:00.000Z');
      installFakeApi({
        'usage:task': () => ({
          ...usage,
          sessions: [
            { ...usage.sessions[1], lastAt: '2026-10-14T10:00:00.000Z' },
          ],
        }),
      });
      render(<UsagePanel taskId="t1" now={() => clock} />);
      expect(await screen.findByText('LIVE')).toBeInTheDocument();
      expect(
        document.querySelector('[data-part="bin"].is-live'),
      ).not.toBeNull();
      clock = Date.parse('2026-10-14T10:06:00.000Z');
      act(() => vi.advanceTimersByTime(30_000));
      expect(screen.queryByText('LIVE')).toBeNull();
      expect(document.querySelector('[data-part="bin"].is-live')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it('stops its clock on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      installFakeApi({ 'usage:task': () => usage });
      const { unmount } = render(<UsagePanel taskId="t1" />);
      await screen.findByRole('img', { name: /Cost per 15 minutes/ });
      const before = vi.getTimerCount();
      unmount();
      expect(vi.getTimerCount()).toBeLessThan(before);
    } finally {
      vi.useRealTimers();
    }
  });
  it('mutes and strikes through a non-billable session', async () => {
    installFakeApi({
      'usage:task': () => ({
        ...usage,
        sessions: [{ ...usage.sessions[0], billable: false }],
      }),
    });
    render(<UsagePanel taskId="t1" />);
    const row = (await screen.findAllByRole('row'))[1];
    expect(row).toHaveClass('is-excluded');
  });
  it('draws 24 timeline bins', async () => {
    installFakeApi({ 'usage:task': () => usage });
    render(<UsagePanel taskId="t1" />);
    expect(
      await screen.findByRole('img', { name: /Cost per 15 minutes/ }),
    ).toBeInTheDocument();
    expect(document.querySelectorAll('[data-part="bin"]')).toHaveLength(24);
  });
});
