import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BudgetView } from '../../../shared/budgetView';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { BudgetBand, modelColor } from './BudgetBand';

const view = (o: Partial<BudgetView> = {}): BudgetView => ({
  monthOffset: 0,
  startDay: '2026-10-01',
  endDay: '2026-10-31',
  budgetEur: 500,
  spentEur: 312,
  daysElapsed: 19,
  daysInMonth: 31,
  forecastEur: 470,
  status: 'onTrack',
  cumulative: [{ day: '2026-10-01', eur: 12 }],
  days: [],
  models: [
    { model: 'claude-opus-5-5', costEur: 241, tokens: 1_000_000, requests: 10 },
  ],
  todayEur: 14,
  weekEur: 71,
  outsideShare: 0.38,
  notCounted: [],
  unpriced: [],
  sources: { claudeCode: true, openCode: true },
  alertsDue: [],
  ...o,
});

describe('BudgetBand', () => {
  it('shows spend of budget and an on-track forecast', async () => {
    installFakeApi({ 'budget:get': () => view() });
    render(<BudgetBand />);
    expect(await screen.findByText('€312.00')).toBeTruthy();
    expect(screen.getByText('of €500.00')).toBeTruthy();
    expect(screen.getByText('On track: about €470.00 by Oct 31')).toBeTruthy();
    expect(
      screen.getByText('Today €14.00 · This week €71.00 · 38% outside Shellie'),
    ).toBeTruthy();
  });

  it('warns when the pace or the spend goes over', async () => {
    installFakeApi({
      'budget:get': () => view({ status: 'paceOver', forecastEur: 510 }),
    });
    render(<BudgetBand />);
    expect(
      await screen.findByText('On pace for €510.00, €10.00 over'),
    ).toBeTruthy();
  });

  it('shows over budget', async () => {
    installFakeApi({
      'budget:get': () =>
        view({ status: 'over', spentEur: 530, forecastEur: 800 }),
    });
    render(<BudgetBand />);
    expect(await screen.findByText('Over budget by €30.00')).toBeTruthy();
  });

  it('offers to set a budget when there is none', async () => {
    installFakeApi({
      'budget:get': () => view({ budgetEur: null, status: 'none' }),
    });
    render(<BudgetBand />);
    expect(await screen.findByText('€312.00 this month')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Set a monthly budget' }),
    ).toBeTruthy();
  });

  it('lists not-counted and unpriced usage', async () => {
    installFakeApi({
      'budget:get': () =>
        view({
          notCounted: [
            {
              model: 'claude-sonnet-4.6',
              provider: 'github-copilot',
              requests: 59,
              tokens: 700_000,
            },
          ],
          unpriced: [{ model: 'claude-mystery-9', tokens: 2_000, requests: 2 }],
        }),
    });
    render(<BudgetBand />);
    expect(
      await screen.findByText(
        'Not counted: claude-sonnet-4.6 via github-copilot, 59 requests',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Unpriced: claude-mystery-9, 2k tokens'),
    ).toBeTruthy();
  });

  it('says when neither tool was found', async () => {
    installFakeApi({
      'budget:get': () =>
        view({
          sources: { claudeCode: false, openCode: false },
          spentEur: 0,
          models: [],
        }),
    });
    render(<BudgetBand />);
    expect(
      await screen.findByText(
        'No Claude Code or OpenCode usage found on this computer.',
      ),
    ).toBeTruthy();
  });

  it('steps to the previous month and tracks it', async () => {
    const { calls, tracked } = installFakeApi({
      'budget:get': (offset) => view({ monthOffset: offset }),
    });
    render(<BudgetBand />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Previous month' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Next month' }),
    ).toBeTruthy();
    expect(
      calls.some((c) => c.channel === 'budget:get' && c.args[0] === -1),
    ).toBe(true);
    expect(
      tracked.some(
        (t) =>
          t.type === 'event' &&
          t.name === 'home.clicked' &&
          t.props?.band === 'budget-month',
      ),
    ).toBe(true);
  });

  it('refetches on budget:changed', async () => {
    let spent = 1;
    const { emit } = installFakeApi({
      'budget:get': () => view({ spentEur: spent }),
    });
    render(<BudgetBand />);
    expect(await screen.findByText('€1.00')).toBeTruthy();
    spent = 2;
    act(() => emit('budget:changed', {}));
    expect(await screen.findByText('€2.00')).toBeTruthy();
  });
});

describe('modelColor', () => {
  it('colours by model family', () => {
    expect(modelColor('claude-opus-5-5')).toBe('var(--chart-opus)');
    expect(modelColor('claude-sonnet-4.6')).toBe('var(--chart-sonnet)');
    expect(modelColor('claude-haiku-5-5')).toBe('var(--chart-haiku)');
    expect(modelColor('claude-fable-5-1')).toBe('var(--chart-fable)');
    expect(modelColor('x')).toBe('var(--line-strong)');
  });
});
