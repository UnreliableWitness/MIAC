import { describe, expect, it } from 'vitest';
import type { RecentPoint, SessionSummary, TaskUsage } from './usage';
import { isLive, timeline, tokenMix } from './usageViews';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const at = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const p = (
  minAgo: number,
  costEur: number,
  tool: RecentPoint['tool'] = 'claude-code',
): RecentPoint => ({ at: at(minAgo), tool, costEur });

describe('timeline', () => {
  it('always returns 24 bins of 15 minutes, oldest first, ending at now', () => {
    const bins = timeline([], NOW);
    expect(bins).toHaveLength(24);
    expect(bins[23].start).toBe(NOW - 15 * 60_000);
    expect(bins[0].start).toBe(NOW - 6 * 3600_000);
    expect(bins.every((b) => b.costEur === 0 && b.dominant === null)).toBe(
      true,
    );
  });
  it('bins points and picks the dominant tool', () => {
    const bins = timeline(
      [p(1, 2), p(2, 1, 'copilot-cli'), p(3, 0.5, 'copilot-cli')],
      NOW,
    );
    expect(bins[23].costEur).toBeCloseTo(3.5);
    expect(bins[23].byTool).toEqual({ 'claude-code': 2, 'copilot-cli': 1.5 });
    expect(bins[23].dominant).toBe('claude-code');
  });
  it('includes a point at exactly now - 6h in the first bin and drops older and future points', () => {
    const bins = timeline([p(360, 1), p(361, 9), p(-5, 9)], NOW);
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
