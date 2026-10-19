import {
  type AlertKind,
  type BudgetRow,
  type BudgetSettings,
  budgetMonth,
  dayKey,
  tokensOf,
} from './budget';

export type ModelTotal = {
  model: string;
  costEur: number;
  tokens: number;
  requests: number;
};
export type BudgetDay = {
  day: string;
  future: boolean;
  today: boolean;
  costEur: number;
  byModel: {
    model: string;
    costEur: number;
    outsideEur: number;
    tokens: number;
  }[];
};
export type BudgetView = {
  monthOffset: number;
  startDay: string;
  /** Last day of the budget month, inclusive. */
  endDay: string;
  budgetEur: number | null;
  spentEur: number;
  daysElapsed: number;
  daysInMonth: number;
  /** Null when hidden: not the current month, or three days or fewer elapsed. */
  forecastEur: number | null;
  status: 'none' | 'onTrack' | 'paceOver' | 'over';
  /** Past days and today only. */
  cumulative: { day: string; eur: number }[];
  days: BudgetDay[];
  /** Counted models, by cost descending. */
  models: ModelTotal[];
  todayEur: number;
  /** Sums only days inside the budget month. */
  weekEur: number;
  /** Share of spentEur spent outside Shellie, 0-1. */
  outsideShare: number;
  notCounted: {
    model: string;
    provider: string;
    requests: number;
    tokens: number;
  }[];
  unpriced: { model: string; tokens: number; requests: number }[];
  sources: { claudeCode: boolean; openCode: boolean };
  alertsDue: AlertKind[];
};

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function budgetView(input: {
  days: Record<string, BudgetRow[]>;
  settings: BudgetSettings;
  now: Date;
  monthOffset: number;
  fired: AlertKind[];
  sources: { claudeCode: boolean; openCode: boolean };
}): BudgetView {
  const { settings, now, monthOffset } = input;
  const month = budgetMonth(now, settings.monthStartDay, monthOffset);
  const today = dayKey(now);
  const current = monthOffset === 0;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const weekFrom = dayKey(weekStart);

  const models = new Map<string, ModelTotal>();
  const notCounted = new Map<
    string,
    { model: string; provider: string; requests: number; tokens: number }
  >();
  const unpriced = new Map<
    string,
    { model: string; tokens: number; requests: number }
  >();
  let spent = 0;
  let outside = 0;
  let running = 0;
  const cumulative: { day: string; eur: number }[] = [];
  const days: BudgetDay[] = month.days.map((day) => {
    const byModel = new Map<
      string,
      { model: string; costEur: number; outsideEur: number; tokens: number }
    >();
    let dayEur = 0;
    for (const row of input.days[day] ?? []) {
      const tokens = tokensOf(row);
      if (!row.counted) {
        const k = `${row.provider}|${row.model}`;
        const e = notCounted.get(k) ?? {
          model: row.model,
          provider: row.provider,
          requests: 0,
          tokens: 0,
        };
        e.requests += row.requests;
        e.tokens += tokens;
        notCounted.set(k, e);
        continue;
      }
      if (row.costEur === null) {
        const e = unpriced.get(row.model) ?? {
          model: row.model,
          tokens: 0,
          requests: 0,
        };
        e.tokens += tokens;
        e.requests += row.requests;
        unpriced.set(row.model, e);
        continue;
      }
      dayEur += row.costEur;
      if (!row.inShellie) outside += row.costEur;
      const m = byModel.get(row.model) ?? {
        model: row.model,
        costEur: 0,
        outsideEur: 0,
        tokens: 0,
      };
      m.costEur += row.costEur;
      if (!row.inShellie) m.outsideEur += row.costEur;
      m.tokens += tokens;
      byModel.set(row.model, m);
      const t = models.get(row.model) ?? {
        model: row.model,
        costEur: 0,
        tokens: 0,
        requests: 0,
      };
      t.costEur += row.costEur;
      t.tokens += tokens;
      t.requests += row.requests;
      models.set(row.model, t);
    }
    spent += dayEur;
    const future = current && day > today;
    if (!future) {
      running += dayEur;
      cumulative.push({ day, eur: round6(running) });
    }
    return {
      day,
      future,
      today: current && day === today,
      costEur: round6(dayEur),
      byModel: [...byModel.values()],
    };
  });

  const daysInMonth = month.days.length;
  const daysElapsed = current ? month.days.indexOf(today) + 1 : daysInMonth;
  const forecastEur =
    current && daysElapsed > 3
      ? round6((spent / daysElapsed) * daysInMonth)
      : null;
  const budget = settings.monthlyEur;
  const status: BudgetView['status'] =
    budget === null
      ? 'none'
      : spent > budget
        ? 'over'
        : forecastEur !== null && forecastEur > budget
          ? 'paceOver'
          : 'onTrack';

  const alertsDue: AlertKind[] = [];
  if (budget !== null && current) {
    const due = (k: AlertKind, hit: boolean) => {
      if (hit && settings.alerts[k] && !input.fired.includes(k))
        alertsDue.push(k);
    };
    due('at80', spent >= budget * 0.8);
    due('forecastOver', forecastEur !== null && forecastEur > budget);
    due('at100', spent >= budget);
  }

  const sumDays = (from: string) =>
    round6(
      days
        .filter((d) => d.day >= from && d.day <= today)
        .reduce((a, d) => a + d.costEur, 0),
    );
  return {
    monthOffset,
    startDay: month.days[0],
    endDay: month.days.at(-1)!,
    budgetEur: budget,
    spentEur: round6(spent),
    daysElapsed,
    daysInMonth,
    forecastEur,
    status,
    cumulative,
    days,
    models: [...models.values()]
      .map((m) => ({ ...m, costEur: round6(m.costEur) }))
      .sort((a, b) => b.costEur - a.costEur),
    todayEur: current ? sumDays(today) : 0,
    weekEur: current ? sumDays(weekFrom) : 0,
    outsideShare: spent > 0 ? outside / spent : 0,
    notCounted: [...notCounted.values()],
    unpriced: [...unpriced.values()],
    sources: input.sources,
    alertsDue,
  };
}
