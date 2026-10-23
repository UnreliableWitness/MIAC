import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installFakeApi } from '../test-helpers/fakeApi';
import { BudgetSection } from './BudgetSection';

describe('BudgetSection', () => {
  it('saves a budget, start day and alert toggles', async () => {
    const { calls } = installFakeApi();
    render(<BudgetSection />);
    const claude = within(
      await screen.findByRole('group', { name: 'Claude budget' }),
    );
    fireEvent.change(await claude.findByLabelText('Monthly budget (€)'), {
      target: { value: '500' },
    });
    fireEvent.change(claude.getByLabelText('Month starts on day'), {
      target: { value: '15' },
    });
    fireEvent.click(claude.getByLabelText('Warn when the forecast goes over'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const saved = calls.filter((c) => c.channel === 'settings:save').at(-1)
        ?.args[0] as { claudeBudget: unknown };
      expect(saved.claudeBudget).toEqual({
        monthlyEur: 500,
        monthStartDay: 15,
        alerts: { at80: true, forecastOver: false, at100: true },
      });
    });
  });

  it('rejects a bad start day without saving', async () => {
    const { calls } = installFakeApi();
    render(<BudgetSection />);
    const claude = within(
      await screen.findByRole('group', { name: 'Claude budget' }),
    );
    fireEvent.change(claude.getByLabelText('Month starts on day'), {
      target: { value: '31' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Month start day must be 1 to 28.'),
    ).toBeTruthy();
    expect(calls.some((c) => c.channel === 'settings:save')).toBe(false);
  });

  it('edits both budgets', async () => {
    const { calls } = installFakeApi();
    render(<BudgetSection />);
    const copilot = within(
      await screen.findByRole('group', { name: 'Copilot budget' }),
    );
    fireEvent.change(copilot.getByLabelText('Monthly budget (€)'), {
      target: { value: '120' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const saved = calls.filter((c) => c.channel === 'settings:save').at(-1)
        ?.args[0] as {
        copilotBudget: { monthlyEur: number };
        claudeBudget: { monthlyEur: number | null };
      };
      expect(saved.copilotBudget.monthlyEur).toBe(120);
      expect(saved.claudeBudget.monthlyEur).toBeNull();
    });
  });

  it('locks a managed budget', async () => {
    const { calls } = installFakeApi();
    render(<BudgetSection managed={{ claude: false, copilot: true }} />);
    const copilot = within(
      await screen.findByRole('group', { name: 'Copilot budget' }),
    );
    expect(
      (copilot.getByLabelText('Monthly budget (€)') as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (copilot.getByLabelText('Month starts on day') as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(copilot.getByText('Set by your cost server')).toBeTruthy();
    const claude = within(screen.getByRole('group', { name: 'Claude budget' }));
    expect(claude.queryByText('Set by your cost server')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const saved = calls.filter((c) => c.channel === 'settings:save').at(-1)
        ?.args[0] as Record<string, unknown>;
      expect(saved.claudeBudget).toBeDefined();
      expect(saved.copilotBudget).toMatchObject({
        monthlyEur: null,
        monthStartDay: 1,
      });
    });
  });
});
