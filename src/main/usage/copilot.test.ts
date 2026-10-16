import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { copilotAgentIntervals, parseCopilotLine } from './copilot';

const lines = readFileSync(
  path.join(__dirname, '__fixtures__', 'copilot', 'synthetic-spans.jsonl'),
  'utf8',
)
  .trim()
  .split('\n');

describe('parseCopilotLine', () => {
  it('reads a chat span from an OTLP traces line', () => {
    expect(parseCopilotLine(lines[0], 't1')).toEqual({
      unreadable: 0,
      events: [
        {
          id: 'aaaa:0001',
          taskId: 't1',
          tool: 'copilot-cli',
          sessionId: 'aaaa',
          model: 'gpt-5.5',
          at: new Date(1760436000000).toISOString(),
          inputTokens: 12000,
          outputTokens: 800,
          cacheReadTokens: 30000,
          cacheWriteTokens: 0,
          fast: false,
        },
      ],
    });
  });
  it('reads a flat span with plain attributes and hrtime start', () => {
    expect(parseCopilotLine(lines[1], 't1').events[0]).toMatchObject({
      id: 'bbbb:0002',
      sessionId: 'bbbb',
      model: 'claude-sonnet-4.6',
      at: new Date(1760436060000).toISOString(),
      inputTokens: 5000,
      outputTokens: 400,
      cacheWriteTokens: 1000,
    });
  });
  it('ignores non-chat spans and other signals', () => {
    expect(parseCopilotLine(lines[2], 't1')).toEqual({
      events: [],
      unreadable: 0,
    });
    expect(parseCopilotLine(lines[3], 't1')).toEqual({
      events: [],
      unreadable: 0,
    });
    expect(parseCopilotLine('', 't1')).toEqual({ events: [], unreadable: 0 });
  });
  it('counts garbage and chat spans without a model as unreadable', () => {
    expect(parseCopilotLine('{not json', 't1')).toEqual({
      events: [],
      unreadable: 1,
    });
    expect(
      parseCopilotLine(
        '{"name":"chat x","traceId":"c","spanId":"1","attributes":{"gen_ai.usage.input_tokens":5}}',
        't1',
      ),
    ).toEqual({ events: [], unreadable: 1 });
  });
  it('falls back to now for an hrtime start past year 9999', () => {
    const line = JSON.stringify({
      name: 'chat gpt-5.5',
      spanContext: { traceId: 'cccc', spanId: '0003' },
      startTime: [1e15, 0],
      attributes: {
        'gen_ai.response.model': 'gpt-5.5',
        'gen_ai.usage.input_tokens': 10,
      },
    });
    const at = parseCopilotLine(line, 't1').events[0].at;
    expect(Math.abs(Date.now() - Date.parse(at))).toBeLessThan(60_000);
  });
});

describe('copilotAgentIntervals', () => {
  it('reads agent, chat and tool spans that have a start and an end', () => {
    const line = (name: string, extra: Record<string, unknown>) =>
      JSON.stringify({ name, ...extra });
    expect(
      copilotAgentIntervals(
        line('invoke_agent x', {
          startTime: [1760436000, 0],
          endTime: [1760436012, 0],
        }),
      ),
    ).toEqual([[1760436000000, 1760436012000]]);
    expect(
      copilotAgentIntervals(
        line('execute_tool y', {
          startTimeUnixNano: '1760436000000000000',
          endTimeUnixNano: '1760436002500000000',
        }),
      ),
    ).toEqual([[1760436000000, 1760436002500]]);
    expect(
      copilotAgentIntervals(
        line('other', { startTime: [1, 0], endTime: [2, 0] }),
      ),
    ).toEqual([]);
    expect(copilotAgentIntervals('not json')).toEqual([]);
  });
  it('gives nothing for the fixture lines without an end', () => {
    for (const l of lines) expect(copilotAgentIntervals(l)).toEqual([]);
  });
});
