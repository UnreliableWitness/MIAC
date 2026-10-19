import { z } from 'zod';

export const BudgetSettingsSchema = z.object({
  /** The company's monthly Claude budget in EUR; null means no budget (spend shown, no alerts). */
  monthlyEur: z.number().positive().nullable(),
  /** Day of the month the budget resets on (1-28). */
  monthStartDay: z.number().int().min(1).max(28),
  alerts: z.object({
    at80: z.boolean(),
    forecastOver: z.boolean(),
    at100: z.boolean(),
  }),
});
export type BudgetSettings = z.infer<typeof BudgetSettingsSchema>;
export const defaultBudgetSettings = (): BudgetSettings => ({
  monthlyEur: null,
  monthStartDay: 1,
  alerts: { at80: true, forecastOver: true, at100: true },
});
