import { useEffect, useState } from 'react';
import type { BudgetView } from '../../shared/budgetView';
import { api } from '../api';

export function useBudget(monthOffset: number): BudgetView | null {
  const [view, setView] = useState<BudgetView | null>(null);
  useEffect(() => {
    let live = true;
    setView(null);
    const load = () =>
      api()
        .invoke('budget:get', 'claude', monthOffset)
        .then((v) => live && setView(v))
        .catch(() => undefined);
    void load();
    const off = api().on('budget:changed', () => void load());
    return () => {
      live = false;
      off();
    };
  }, [monthOffset]);
  return view;
}
