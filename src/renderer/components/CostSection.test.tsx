import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Rate } from '../../shared/usage';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { CostSection } from './CostSection';

const rates: Rate[] = [
  {
    id: 'anthropic-opus-5-5',
    label: 'Claude Opus 5.5',
    match: ['claude-opus-5-5'],
    minInputTokens: 0,
    fast: false,
    inputPerM: 4,
    cachedInputPerM: 0.2,
    cacheWritePerM: 5,
    outputPerM: 20,
  },
];
const settings = {
  version: 1 as const,
  receiverPort: 4319,
  hourlySync: true,
  showSplash: true,
  sendTelemetry: true,
};

beforeEach(() => {
  useStore.setState({
    notices: [],
    connections: [
      {
        id: 'c1',
        name: 'unreliablewitness',
        organizationUrl: 'https://dev.azure.com/unreliablewitness',
        project: 'MIAC',
        user: 'D',
        status: 'ok',
        checkedAt: null,
        userUniqueName: null,
      },
    ],
  });
});

describe('CostSection', () => {
  it('saves the port and hourly sync, and has no exchange rate or markup inputs', async () => {
    const { calls } = installFakeApi({
      'settings:get': () => settings,
      'settings:save': (s) => s,
      'rates:list': () => ({ rates, officialAsOf: '2026-10-14' }),
    });
    render(<CostSection />);
    await screen.findByLabelText('Usage receiver port');
    expect(screen.queryByLabelText('USD to EUR')).toBeNull();
    expect(screen.queryByLabelText('Markup %')).toBeNull();
    expect(screen.getByText('EUR at 0.92 per USD (built in)')).toBeTruthy();
    await userEvent.click(screen.getByRole('checkbox', { name: /every hour/ }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Save settings' }),
    );
    expect(calls.find((c) => c.channel === 'settings:save')?.args[0]).toEqual({
      version: 1,
      receiverPort: 4319,
      hourlySync: false,
      showSplash: true,
      sendTelemetry: true,
    });
  });
  it('shows the receiver status and Copilot counters', async () => {
    installFakeApi({
      'settings:get': () => settings,
      'rates:list': () => ({ rates, officialAsOf: '2026-10-14' }),
      'usage:receiverStatus': () => ({
        listening: false,
        port: 4319,
        error: 'Port 4319 is in use by another program',
        copilot: { records: 3, unreadable: 1 },
      }),
    });
    render(<CostSection />);
    expect(await screen.findByText(/Port 4319 is in use/)).toBeTruthy();
    expect(
      screen.getByText(
        'Copilot CLI: 3 records captured, 1 unreadable (unverified: built from documentation)',
      ),
    ).toBeTruthy();
  });
  it('shows the official rates read-only', async () => {
    installFakeApi({
      'settings:get': () => settings,
      'rates:list': () => ({ rates, officialAsOf: '2026-10-14' }),
    });
    render(<CostSection />);
    expect(
      await screen.findByText(
        'Official list prices as of 2026-10-14 (USD per 1M tokens)',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Claude Opus 5.5')).toBeTruthy();
    expect(screen.getByText('claude-opus-5-5')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add rate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save rates' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Reset to official prices' }),
    ).toBeNull();
    expect(
      screen
        .queryAllByRole('spinbutton')
        .filter((i) => (i.getAttribute('aria-label') ?? '').includes('per 1M')),
    ).toHaveLength(0);
  });
  it('shows nothing of the rate table until the official prices load', async () => {
    installFakeApi({
      'settings:get': () => settings,
      'rates:list': () => new Promise(() => {}),
    });
    render(<CostSection />);
    expect(await screen.findByLabelText('Usage receiver port')).toBeTruthy();
    expect(screen.queryByText(/Official list prices as of\s+\(/)).toBeNull();
  });
  it('refuses to save blank settings numbers', async () => {
    const { calls } = installFakeApi({
      'settings:get': () => settings,
      'settings:save': (s) => s,
      'rates:list': () => ({ rates, officialAsOf: '2026-10-14' }),
    });
    render(<CostSection />);
    await userEvent.clear(await screen.findByLabelText('Usage receiver port'));
    await userEvent.click(
      screen.getByRole('button', { name: 'Save settings' }),
    );
    expect(
      await screen.findByText('Usage receiver port must be a number'),
    ).toBeTruthy();
    expect(calls.some((c) => c.channel === 'settings:save')).toBe(false);
  });
  it('checks the work item fields of a connection', async () => {
    installFakeApi({
      'settings:get': () => settings,
      'rates:list': () => ({ rates, officialAsOf: '2026-10-14' }),
      'usage:fieldsStatus': () => ({
        connectionId: 'c1',
        types: [
          {
            type: 'Issue',
            present: ['Custom.AICost'],
            missing: [
              'Custom.AICostClaude',
              'Custom.AICostCopilot',
              'Custom.AITokens',
            ],
          },
          { type: 'Task', present: [], missing: [] },
        ],
      }),
    });
    render(<CostSection />);
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Check fields of unreliablewitness',
      }),
    );
    expect(
      await screen.findByText(
        'Issue: 1 of 4 fields (missing Custom.AICostClaude, Custom.AICostCopilot, Custom.AITokens)',
      ),
    ).toBeTruthy();
  });
});
