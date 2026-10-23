import { describe, expect, it } from 'vitest';
import type { RecentPoint, SessionSummary, TaskUsage } from './usage';
import {
  hourTicks,
  isLive,
  modelLegendName,
  modelShares,
  shortModelName,
  timeline,
  tokenMix,
} from './usageViews';
import type { ModelTotals } from './usage';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const p = (
  minAgo: number,
  costEur: number,
  tool: RecentPoint['tool'] = 'claude-code',
): RecentPoint => ({ at: at(minAgo), tool, costEur });

describe('hourTicks', () => {
  it('marks the bin edges on local whole hours', () => {
    const bins = timeline([], NOW + 7 * 60_000);
    const ticks = hourTicks(bins);
    expect(ticks.length).toBeGreaterThanOrEqual(5);
    for (const t of ticks) {
      expect(new Date(t.at).getMinutes()).toBe(0);
      expect(t.at).toBe(
        t.edge < bins.length ? bins[t.edge].start : bins[t.edge - 1].end,
      );
    }
    expect(ticks[1].edge - ticks[0].edge).toBe(4);
  });
});

const model = (over: Partial<ModelTotals>): ModelTotals => ({
  tool: 'claude-code',
  model: 'claude-sonnet-5-5',
  label: 'Claude Sonnet 5.5',
  costEur: 1,
  tokens: 1,
  requests: 1,
  unpricedRequests: 0,
  ...over,
});

describe('model names', () => {
  it('shortens labels and raw ids', () => {
    expect(shortModelName('Claude Sonnet 5.5')).toBe('Sonnet 5.5');
    expect(shortModelName('claude-haiku-5-5')).toBe('Haiku 5.5');
    expect(shortModelName('claude-opus-5-20261001')).toBe('Opus 5');
    expect(shortModelName('GPT-5.5')).toBe('GPT-5.5');
  });
  it('marks Copilot models and computes shares', () => {
    expect(
      modelLegendName(model({ tool: 'copilot-cli', label: 'GPT-5.5' })),
    ).toBe('GPT-5.5 (Copilot)');
    expect(modelShares([model({ costEur: 3 }), model({ costEur: 1 })])).toEqual(
      [0.75, 0.25],
    );
    expect(modelShares([model({ costEur: 0 })])).toEqual([0]);
  });
});

describe('timeline', () => {
  it('always returns 24 bins of 15 minutes on quarter hours, oldest first, the last holding now', () => {
    const bins = timeline([], NOW + 7 * 60_000);
    expect(bins).toHaveLength(24);
    expect(bins[23].start).toBe(NOW);
    expect(bins[23].end).toBe(NOW + 15 * 60_000);
    expect(bins[0].start).toBe(NOW - 23 * 15 * 60_000);
    expect(bins.every((b) => b.end - b.start === 15 * 60_000)).toBe(true);
    expect(bins.every((b) => b.costEur === 0 && b.dominant === null)).toBe(
      true,
    );
  });
  it('bins points and picks the dominant tool', () => {
    const bins = timeline(
      [p(1, 2), p(2, 1, 'copilot-cli'), p(3, 0.5, 'copilot-cli')],
      NOW,
    );
    expect(bins[22].costEur).toBeCloseTo(3.5);
    expect(bins[22].byTool).toEqual({
      'claude-code': 2,
      'copilot-cli': 1.5,
      opencode: 0,
    });
    expect(bins[22].dominant).toBe('claude-code');
  });
  it('includes a point at the first bin start and drops older and future points', () => {
    const bins = timeline([p(345, 1), p(346, 9), p(-5, 9)], NOW);
    expect(bins[0].costEur).toBe(1);
    expect(bins.reduce((n, b) => n + b.costEur, 0)).toBe(1);
  });
  it('puts a point at exactly now in the last bin', () => {
    expect(timeline([p(0, 4)], NOW)[23].costEur).toBe(4);
  });
});

const session = (over: Partial<SessionSummary>): SessionSummary => ({
  sessionId: 's',
  tool: 'claude-code',
  startedAt: at(30),
  lastAt: at(10),
  models: ['m'],
  requests: 1,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  unpricedRequests: 0,
  billable: true,
  ...over,
});

describe('tokenMix', () => {
  it('sums billable sessions only', () => {
    const u = {
      sessions: [
        session({
          inputTokens: 10,
          outputTokens: 2,
          cacheReadTokens: 100,
          cacheWriteTokens: 5,
        }),
        session({ sessionId: 'x', inputTokens: 1000, billable: false }),
      ],
    } as TaskUsage;
    expect(tokenMix(u)).toEqual({
      cacheRead: 100,
      input: 10,
      cacheWrite: 5,
      output: 2,
    });
  });
});

describe('isLive', () => {
  it('is live within 5 minutes of the last event', () => {
    expect(isLive(session({ lastAt: at(4) }), NOW)).toBe(true);
    expect(isLive(session({ lastAt: at(6) }), NOW)).toBe(false);
  });
});
