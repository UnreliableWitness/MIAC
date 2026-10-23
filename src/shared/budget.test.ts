import { describe, expect, it } from 'vitest';
import { budgetMonth, dayKey, tokensOf, vendorOf } from './budget';

describe('dayKey', () => {
  it('uses local dates', () =>
    expect(dayKey(new Date(2026, 9, 5, 23, 30))).toBe('2026-10-05'));
});

describe('budgetMonth', () => {
  it('runs from the 1st by default', () => {
    const m = budgetMonth(new Date(2026, 9, 19, 12), 1);
    expect(dayKey(m.start)).toBe('2026-10-01');
    expect(dayKey(m.end)).toBe('2026-11-01');
    expect(m.days).toHaveLength(31);
  });
  it('starts on day 15 of last month when today is before the 15th', () => {
    const m = budgetMonth(new Date(2026, 9, 3, 9), 15);
    expect(dayKey(m.start)).toBe('2026-09-15');
    expect(dayKey(m.end)).toBe('2026-10-15');
    expect(m.days[0]).toBe('2026-09-15');
    expect(m.days.at(-1)).toBe('2026-10-14');
  });
  it('steps back with an offset, across a year', () => {
    const m = budgetMonth(new Date(2026, 0, 10), 1, -1);
    expect(dayKey(m.start)).toBe('2025-12-01');
    expect(m.days).toHaveLength(31);
  });
});

describe('tokensOf', () => {
  it('adds all token kinds', () =>
    expect(
      tokensOf({
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWrite5mTokens: 4,
        cacheWrite1hTokens: 5,
      }),
    ).toBe(15));
});

describe('vendorOf', () => {
  it('puts Claude Code and Anthropic OpenCode on Claude, Copilot CLI and Copilot OpenCode on Copilot, the rest nowhere', () => {
    expect(vendorOf({ tool: 'claude-code', provider: 'anthropic' })).toBe(
      'claude',
    );
    expect(vendorOf({ tool: 'opencode', provider: 'anthropic' })).toBe(
      'claude',
    );
    expect(vendorOf({ tool: 'copilot-cli', provider: 'github-copilot' })).toBe(
      'copilot',
    );
    expect(vendorOf({ tool: 'opencode', provider: 'github-copilot' })).toBe(
      'copilot',
    );
    expect(vendorOf({ tool: 'opencode', provider: 'openai' })).toBeNull();
  });
});
