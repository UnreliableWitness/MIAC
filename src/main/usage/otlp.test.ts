import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { attrMap, parseClaudeLogs } from './otlp';

const FIXTURE_TASK = '00000000-0000-4000-8000-000000000001';
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(path.join(__dirname, '__fixtures__', 'claude', name), 'utf8'),
  ) as unknown;

const kv = (key: string, value: Record<string, unknown>) => ({ key, value });
const body = (
  attrs: { key: string; value: Record<string, unknown> }[],
  resource = [kv('miac.task.id', { stringValue: 'task-9' })],
) => ({
  resourceLogs: [
    {
      resource: { attributes: resource },
      scopeLogs: [
        {
          logRecords: [
            {
              timeUnixNano: '1760436000000000000',
              body: { stringValue: 'claude_code.api_request' },
              attributes: [
                kv('event.name', { stringValue: 'api_request' }),
                ...attrs,
              ],
            },
          ],
        },
      ],
    },
  ],
});
const full = [
  kv('model', { stringValue: 'claude-opus-5-5' }),
  kv('input_tokens', { intValue: '1200' }),
  kv('output_tokens', { intValue: 300 }),
  kv('cache_read_tokens', { intValue: '45000' }),
  kv('cache_creation_tokens', { intValue: '2000' }),
  kv('cost_usd', { doubleValue: 0.05 }),
  kv('speed', { stringValue: 'fast' }),
  kv('request_id', { stringValue: 'req_1' }),
  kv('session.id', { stringValue: 'sess_1' }),
];

describe('attrMap', () => {
  it('reads every OTLP AnyValue kind, including int64 as string', () => {
    expect(
      attrMap([
        kv('a', { stringValue: 'x' }),
        kv('b', { intValue: '7' }),
        kv('c', { doubleValue: 1.5 }),
        kv('d', { boolValue: true }),
        kv('e', {}),
      ]),
    ).toEqual({ a: 'x', b: 7, c: 1.5, d: true, e: null });
  });
});

describe('parseClaudeLogs', () => {
  it('maps an api_request record to a usage event', () => {
    const { events, skipped } = parseClaudeLogs(body(full));
    expect(skipped).toBe(0);
    expect(events).toEqual([
      {
        id: 'req_1',
        taskId: 'task-9',
        tool: 'claude-code',
        sessionId: 'sess_1',
        model: 'claude-opus-5-5',
        at: new Date(1760436000000).toISOString(),
        inputTokens: 1200,
        outputTokens: 300,
        cacheReadTokens: 45000,
        cacheWriteTokens: 2000,
        fast: true,
      },
    ]);
  });
  it('lets a record attribute carry the task id when the resource does not', () => {
    const { events } = parseClaudeLogs(
      body([...full, kv('miac.task.id', { stringValue: 'task-r' })], []),
    );
    expect(events[0].taskId).toBe('task-r');
  });
  it('ignores records without a task id and other event names', () => {
    expect(parseClaudeLogs(body(full, [])).events).toEqual([]);
    const other = body(full);
    (
      other.resourceLogs[0].scopeLogs[0].logRecords[0] as { body: unknown }
    ).body = { stringValue: 'claude_code.tool_result' };
    other.resourceLogs[0].scopeLogs[0].logRecords[0].attributes[0] = kv(
      'event.name',
      { stringValue: 'tool_result' },
    );
    expect(parseClaudeLogs(other).events).toEqual([]);
  });
  it('counts an api_request without a model or request id as skipped', () => {
    expect(
      parseClaudeLogs(body(full.filter((a) => a.key !== 'model'))),
    ).toEqual({ events: [], skipped: 1 });
    expect(
      parseClaudeLogs(body(full.filter((a) => a.key !== 'request_id'))),
    ).toEqual({ events: [], skipped: 1 });
  });
  it('returns nothing for bodies that are not OTLP logs', () => {
    expect(parseClaudeLogs(null)).toEqual({ events: [], skipped: 0 });
    expect(parseClaudeLogs({ resourceLogs: 'x' })).toEqual({
      events: [],
      skipped: 0,
    });
  });
  it('parses the recorded Claude Code fixture', () => {
    const { events } = parseClaudeLogs(fixture('api-request-logs.json'));
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e).toMatchObject({
        taskId: FIXTURE_TASK,
        tool: 'claude-code',
        fast: false,
      });
      expect(e.model).toMatch(/^claude-/);
      expect(e.id.length).toBeGreaterThan(0);
      expect(e.sessionId.length).toBeGreaterThan(0);
      for (const n of [
        e.inputTokens,
        e.outputTokens,
        e.cacheReadTokens,
        e.cacheWriteTokens,
      ])
        expect(Number.isInteger(n) && n >= 0).toBe(true);
    }
  });
});
