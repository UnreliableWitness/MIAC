import { render, screen, waitFor } from '@testing-library/react';
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
  usdToEur: 0.92,
  markupPct: 0,
  hourlySync: true,
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
      },
    ],
  });
});

describe('CostSection', () => {
  it('saves exchange rate, markup, port and hourly sync', async () => {
    const { calls } = installFakeApi({
      'settings:get': () => settings,
      'settings:save': (s) => s,
      'rates:list': () => ({ rates, officialAsOf: '2026-10-14' }),
    });
    render(<CostSection />);
    const fx = await screen.findByLabelText('USD to EUR');
    await userEvent.clear(fx);
    await userEvent.type(fx, '0.9');
    await userEvent.clear(screen.getByLabelText('Markup %'));
    await userEvent.type(screen.getByLabelText('Markup %'), '10');
    await userEvent.click(
      screen.getByRole('button', { name: 'Save settings' }),
    );
    expect(
      calls.find((c) => c.channel === 'settings:save')?.args[0],
    ).toMatchObject({
      usdToEur: 0.9,
      markupPct: 10,
      receiverPort: 4319,
      hourlySync: true,
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
  it('edits a rate, adds and deletes rows, and resets after confirming', async () => {
    const { calls } = installFakeApi({
      'settings:get': () => settings,
      'rates:list': () => ({ rates, officialAsOf: '2026-10-14' }),
      'rates:save': (r) => r,
      'rates:reset': () => rates,
    });
    render(<CostSection />);
    const input = await screen.findByLabelText('Claude Opus 5.5 input per 1M');
    await userEvent.clear(input);
    await userEvent.type(input, '3.5');
    await userEvent.click(screen.getByRole('button', { name: 'Add rate' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete New rate' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save rates' }));
    const saved = calls.find((c) => c.channel === 'rates:save')
      ?.args[0] as Rate[];
    expect(saved.map((r) => [r.id, r.inputPerM])).toEqual([
      ['anthropic-opus-5-5', 3.5],
    ]);
    await userEvent.click(
      screen.getByRole('button', { name: 'Reset to official prices' }),
    );
    expect(calls.some((c) => c.channel === 'rates:reset')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Yes, reset' }));
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'rates:reset')).toBe(true),
    );
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
