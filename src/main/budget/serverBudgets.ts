import type { BudgetSettings } from '../../shared/budget';
import type { ServerBudget } from '../../shared/costServer';

/**
 * The budget that applies: the cost server's amount and start day for this developer when it has a tier,
 * else the local one. The alert switches are always the developer's own.
 */
export function effectiveBudget(
  local: BudgetSettings,
  server: ServerBudget | null,
): BudgetSettings {
  if (!server) return local;
  return {
    ...local,
    monthlyEur: server.monthlyEur > 0 ? server.monthlyEur : null,
    monthStartDay: Math.min(28, Math.max(1, Math.round(server.monthStartDay))),
  };
}
