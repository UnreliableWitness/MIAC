import { describe, expect, it } from 'vitest';
import type { UsageRecord } from '../../shared/usage';
import { usageCsv } from './csv';

const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  id: 'r',
  taskId: 't',
  tool: 'claude-code',
  sessionId: 's1',
  model: 'claude-opus-5-5',
  at: '2026-10-14T10:00:00.000Z',
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 3,
  cacheWriteTokens: 4,
  fast: false,
  costUsd: 0.5,
  rateId: 'anthropic-opus-5-5',
  rate: null,
  ...over,
});

describe('usageCsv', () => {
  it('writes one row per request with EUR, billable flag and quoting', () => {
    const csv = usageCsv(
      [
        rec({}),
        rec({
          id: 'x',
          sessionId: 's2',
          model: 'odd,"model"',
          costUsd: null,
          rateId: null,
        }),
      ],
      (s) => s === 's1',
      0.9,
    );
    expect(csv.split('\r\n')).toEqual([
      'time,tool,session,model,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,fast,cost_usd,cost_eur,billable,rate_id',
      '2026-10-14T10:00:00.000Z,claude-code,s1,claude-opus-5-5,1,2,3,4,false,0.5,0.45,true,anthropic-opus-5-5',
      '2026-10-14T10:00:00.000Z,claude-code,s2,"odd,""model""",1,2,3,4,false,,,false,',
      '',
    ]);
  });
});
