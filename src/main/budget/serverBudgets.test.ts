import { describe, expect, it } from 'vitest';
import type { BudgetSettings } from '../../shared/budget';
import { effectiveBudget } from './serverBudgets';

const local: BudgetSettings = {
  monthlyEur: 100,
  monthStartDay: 1,
  alerts: { at80: false, forecastOver: true, at100: false },
};

describe('effectiveBudget', () => {
  it('uses the server amount and keeps local alerts', () => {
    expect(
      effectiveBudget(local, { monthlyEur: 250, monthStartDay: 15 }),
    ).toEqual({
      monthlyEur: 250,
      monthStartDay: 15,
      alerts: { at80: false, forecastOver: true, at100: false },
    });
  });

  it('falls back to local without a server tier', () => {
    expect(effectiveBudget(local, null)).toEqual(local);
  });
});
