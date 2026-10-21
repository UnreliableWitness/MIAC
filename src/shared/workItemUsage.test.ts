import { describe, expect, it } from 'vitest';
import type { SessionSummary, TaskUsage } from './usage';
import {
  aiFieldValues,
  renderCostLine,
  renderUsageComment,
  round2,
} from './workItemUsage';

const EURO = String.fromCharCode(0x20ac);
const session = (over: Partial<SessionSummary>): SessionSummary => ({
  sessionId: 's',
  tool: 'claude-code',
  startedAt: '2026-10-14T09:00:00.000Z',
  lastAt: '2026-10-14T09:00:00.000Z',
  models: ['claude-opus-5-5'],
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
const usage = (
  sessions: SessionSummary[],
  over: Partial<TaskUsage> = {},
): TaskUsage => ({
  taskId: 't',
  sessions,
  recent: [],
  byModel: [],
  unpricedRequests: 0,
  usdToEur: 1,
  billable: { costUsd: 23.85, costEur: 23.854, tokens: 6812400 },
  byTool: {
    'claude-code': {
      costUsd: 21.1,
      costEur: 21.104,
      sessions: 4,
      tokens: 6000000,
    },
    'copilot-cli': {
      costUsd: 2.75,
      costEur: 2.75,
      sessions: 2,
      tokens: 812400,
    },
  },
  ...over,
});

describe('workItemUsage', () => {
  it('rounds EUR to cents and keeps tokens whole', () => {
    expect(round2(2.345)).toBe(2.35);
    expect(aiFieldValues(usage([]))).toEqual({
      'Custom.AICost': 23.85,
      'Custom.AICostClaude': 21.1,
      'Custom.AICostCopilot': 2.75,
      'Custom.AITokens': 6812400,
    });
  });
  it('renders the comment in the mockup format', () => {
    const u = usage([
      session({ sessionId: 'a', models: ['claude-opus-5-5'] }),
      session({
        sessionId: 'b',
        models: ['claude-sonnet-5-5', 'claude-opus-5-5'],
      }),
      session({ sessionId: 'c', tool: 'copilot-cli', models: ['gpt-5.5'] }),
      session({
        sessionId: 'd',
        tool: 'copilot-cli',
        models: ['secret-model'],
        billable: false,
      }),
    ]);
    expect(renderUsageComment(u, ['feature/48213-save-delivery-address'])).toBe(
      [
        `AI usage for this work item (Shellie): ${EURO}23.85`,
        `Claude Code: ${EURO}21.10 over 4 sessions (claude-opus-5-5, claude-sonnet-5-5)`,
        `Copilot CLI: ${EURO}2.75 over 2 sessions (gpt-5.5)`,
        'Branch feature/48213-save-delivery-address',
      ].join('\n\n'),
    );
  });
  it('omits tools without usage and mentions unpriced requests', () => {
    const u = usage([session({ sessionId: 'a', unpricedRequests: 3 })], {
      byTool: {
        'claude-code': { costUsd: 1, costEur: 1, sessions: 1, tokens: 10 },
        'copilot-cli': { costUsd: 0, costEur: 0, sessions: 0, tokens: 0 },
      },
      billable: { costUsd: 1, costEur: 1, tokens: 10 },
    });
    expect(renderUsageComment(u, ['b'])).toBe(
      [
        `AI usage for this work item (Shellie): ${EURO}1.00`,
        `Claude Code: ${EURO}1.00 over 1 session (claude-opus-5-5)`,
        'plus 3 requests with unpriced models',
        'Branch b',
      ].join('\n\n'),
    );
  });
  it('names every pushed branch, once each', () => {
    const text = renderUsageComment(usage([]), ['a', 'b', 'a']);
    expect(text.endsWith('\n\nBranches a, b')).toBe(true);
  });
  it('renders the cost line for a pull request description', () => {
    expect(renderCostLine(usage([]))).toBe(
      `AI cost for this task: ${EURO}23.85 (Claude ${EURO}21.10, Copilot ${EURO}2.75)`,
    );
  });
});
