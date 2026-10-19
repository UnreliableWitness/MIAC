import { describe, expect, it } from "vitest";
import type { BudgetRow, BudgetSettings } from "./budget";
import { budgetView } from "./budgetView";

const row = (o: Partial<BudgetRow> = {}): BudgetRow => ({
  tool: "claude-code",
  model: "claude-opus-5-5",
  provider: "anthropic",
  counted: true,
  inShellie: true,
  fast: false,
  requests: 1,
  costEur: 10,
  inputTokens: 100,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  ...o,
});
const settings = (o: Partial<BudgetSettings> = {}): BudgetSettings => ({
  monthlyEur: 500,
  monthStartDay: 1,
  alerts: { at80: true, forecastOver: true, at100: true },
  ...o,
});
const sources = { claudeCode: true, openCode: true };
const view = (
  days: Record<string, BudgetRow[]>,
  o: {
    now?: Date;
    s?: BudgetSettings;
    fired?: ("at80" | "forecastOver" | "at100")[];
    offset?: number;
    label?: (m: string) => string;
  } = {},
) =>
  budgetView({
    days,
    settings: o.s ?? settings(),
    now: o.now ?? new Date(2026, 9, 19, 12),
    monthOffset: o.offset ?? 0,
    fired: o.fired ?? [],
    sources,
    label: o.label,
  });

describe("budgetView", () => {
  it("sums the month and forecasts from the daily pace", () => {
    const v = view({
      "2026-10-01": [row({ costEur: 100 })],
      "2026-10-19": [row({ costEur: 90 })],
      "2026-09-30": [row({ costEur: 999 })],
    });
    expect(v.spentEur).toBe(190);
    expect(v.daysElapsed).toBe(19);
    expect(v.daysInMonth).toBe(31);
    expect(v.forecastEur).toBeCloseTo((190 / 19) * 31, 6);
    expect(v.status).toBe("onTrack");
    expect(v.cumulative.at(-1)).toEqual({ day: "2026-10-19", eur: 190 });
    expect(v.days).toHaveLength(31);
    expect(v.days[19].future).toBe(true);
    expect(v.days[18].today).toBe(true);
  });

  it("flags a forecast over budget, then over budget", () => {
    expect(view({ "2026-10-10": [row({ costEur: 400 })] }).status).toBe(
      "paceOver",
    );
    expect(view({ "2026-10-10": [row({ costEur: 501 })] }).status).toBe("over");
  });

  it("hides the forecast in the first three days and for past months", () => {
    expect(view({}, { now: new Date(2026, 9, 3, 12) }).forecastEur).toBeNull();
    expect(
      view({}, { now: new Date(2026, 9, 4, 12) }).forecastEur,
    ).not.toBeNull();
    expect(view({}, { offset: -1 }).forecastEur).toBeNull();
  });

  it("has status none without a budget, and no alerts", () => {
    const v = view(
      { "2026-10-10": [row({ costEur: 9999 })] },
      { s: settings({ monthlyEur: null }) },
    );
    expect(v.status).toBe("none");
    expect(v.alertsDue).toEqual([]);
  });

  it("respects a month starting on the 15th", () => {
    const v = view(
      {
        "2026-09-20": [row({ costEur: 5 })],
        "2026-10-14": [row({ costEur: 7 })],
        "2026-10-15": [row({ costEur: 100 })],
      },
      { now: new Date(2026, 9, 3, 12), s: settings({ monthStartDay: 15 }) },
    );
    expect(v.startDay).toBe("2026-09-15");
    expect(v.endDay).toBe("2026-10-14");
    expect(v.spentEur).toBe(12);
  });

  it("splits models, today, the week and the outside share", () => {
    const v = view(
      {
        "2026-10-13": [row({ costEur: 10 })], // Tuesday of last week
        "2026-10-12": [row({ costEur: 1000, inShellie: false })], // Monday of last week
        "2026-10-19": [
          row({ costEur: 20, model: "claude-sonnet-5-5", inShellie: false }),
          row({ costEur: 30 }),
        ],
      },
      { s: settings({ monthlyEur: 5000 }) },
    );
    expect(v.models.map((m) => [m.model, m.costEur])).toEqual([
      ["claude-opus-5-5", 1040],
      ["claude-sonnet-5-5", 20],
    ]);
    expect(v.todayEur).toBe(50);
    expect(v.weekEur).toBe(50); // 19 Oct 2026 is itself a Monday
    expect(v.outsideShare).toBeCloseTo(1020 / 1060, 6);
  });

  it("lists not-counted and unpriced usage apart from the totals", () => {
    const v = view({
      "2026-10-19": [
        row({
          counted: false,
          costEur: null,
          provider: "github-copilot",
          model: "claude-sonnet-4.6",
          requests: 59,
        }),
        row({ costEur: null, model: "claude-mystery-9", requests: 2 }),
      ],
    });
    expect(v.spentEur).toBe(0);
    expect(v.notCounted).toEqual([
      {
        model: "claude-sonnet-4.6",
        provider: "github-copilot",
        requests: 59,
        tokens: 100,
      },
    ]);
    expect(v.unpriced).toEqual([
      { model: "claude-mystery-9", requests: 2, tokens: 100 },
    ]);
  });

  it("makes alerts due once per month, forecast only when shown", () => {
    expect(view({ "2026-10-10": [row({ costEur: 410 })] }).alertsDue).toEqual([
      "at80",
      "forecastOver",
    ]);
    expect(
      view({ "2026-10-10": [row({ costEur: 410 })] }, { fired: ["at80"] })
        .alertsDue,
    ).toEqual(["forecastOver"]);
    expect(view({ "2026-10-10": [row({ costEur: 600 })] }).alertsDue).toEqual([
      "at80",
      "forecastOver",
      "at100",
    ]);
    expect(
      view(
        { "2026-10-02": [row({ costEur: 450 })] },
        { now: new Date(2026, 9, 2, 12) },
      ).alertsDue,
    ).toEqual(["at80"]);
    expect(
      view(
        { "2026-10-10": [row({ costEur: 600 })] },
        {
          s: settings({
            alerts: { at80: false, forecastOver: true, at100: false },
          }),
        },
      ).alertsDue,
    ).toEqual(["forecastOver"]);
    expect(
      view({ "2026-09-10": [row({ costEur: 600 })] }, { offset: -1 }).alertsDue,
    ).toEqual([]);
  });

  it("is over at exactly 100% of the budget", () => {
    expect(view({ "2026-10-02": [row({ costEur: 500 })] }).status).toBe("over");
  });

  it("groups and names models through the label function", () => {
    const label = (m: string) =>
      m.startsWith("claude-haiku-4-5") ? "Claude Haiku 4.5" : m;
    const v = view(
      {
        "2026-10-02": [
          row({ model: "claude-haiku-4-5-20251001", costEur: 1 }),
          row({ model: "claude-haiku-4-5", costEur: 2, inShellie: false }),
          row({ model: "claude-haiku-4-5", costEur: null }),
          row({
            model: "claude-haiku-4-5-20251001",
            counted: false,
            costEur: null,
            provider: "github-copilot",
          }),
          row({
            model: "claude-haiku-4-5",
            counted: false,
            costEur: null,
            provider: "github-copilot",
          }),
        ],
      },
      { label },
    );
    expect(v.models.map((m) => [m.model, m.costEur, m.requests])).toEqual([
      ["Claude Haiku 4.5", 3, 2],
    ]);
    expect(v.days[1].byModel.map((m) => m.model)).toEqual(["Claude Haiku 4.5"]);
    expect(v.unpriced.map((m) => m.model)).toEqual(["Claude Haiku 4.5"]);
    expect(v.notCounted).toEqual([
      expect.objectContaining({ model: "Claude Haiku 4.5", requests: 2 }),
    ]);
  });

  it("reports whether the first scan finished", () => {
    expect(view({}).scanned).toBe(true);
    expect(
      budgetView({
        days: {},
        settings: settings(),
        now: new Date(2026, 9, 19, 12),
        monthOffset: 0,
        fired: [],
        sources,
        scanned: false,
      }).scanned,
    ).toBe(false);
  });
});
