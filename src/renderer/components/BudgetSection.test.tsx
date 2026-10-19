import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installFakeApi } from '../test-helpers/fakeApi';
import { BudgetSection } from './BudgetSection';

describe('BudgetSection', () => {
  it('saves a budget, start day and alert toggles', async () => {
    const { calls } = installFakeApi();
    render(<BudgetSection />);
    fireEvent.change(await screen.findByLabelText('Monthly budget (€)'), {
      target: { value: '500' },
    });
    fireEvent.change(screen.getByLabelText('Month starts on day'), {
      target: { value: '15' },
    });
    fireEvent.click(screen.getByLabelText('Warn when the forecast goes over'));
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
    fireEvent.change(await screen.findByLabelText('Month starts on day'), {
      target: { value: '31' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Month start day must be 1 to 28.'),
    ).toBeTruthy();
    expect(calls.some((c) => c.channel === 'settings:save')).toBe(false);
  });
});
