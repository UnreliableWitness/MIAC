import type { UsageRecord } from '../../shared/usage';
import { round6 } from '../pricing/RateTable';

export const cell = (v: string | number | boolean | null): string => {
  const s = v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function usageCsv(
  records: UsageRecord[],
  isBillable: (sessionId: string) => boolean,
  eurFactor: number,
): string {
  const head = [
    'time',
    'tool',
    'session',
    'model',
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'cache_write_tokens',
    'fast',
    'cost_usd',
    'cost_eur',
    'billable',
    'rate_id',
  ];
  const rows = records.map((r) => [
    r.at,
    r.tool,
    r.sessionId,
    r.model,
    r.inputTokens,
    r.outputTokens,
    r.cacheReadTokens,
    r.cacheWriteTokens,
    r.fast,
    r.costUsd,
    r.costUsd === null ? null : round6(r.costUsd * eurFactor),
    isBillable(r.sessionId),
    r.rateId,
  ]);
  return `${[head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
