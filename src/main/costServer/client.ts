import { z } from 'zod';
import type { ServerBudgets } from '../../shared/costServer';
import type { CostRecord } from '../../shared/ledger';

export type CostServerErrorKind = 'network' | 'auth' | 'server' | 'rejected';

/** A failed call. The message never contains the key or the server's text. */
export class CostServerError extends Error {
  constructor(
    readonly kind: CostServerErrorKind,
    readonly status?: number,
  ) {
    super(
      kind === 'network'
        ? 'The cost server could not be reached'
        : `The cost server answered ${kind}${status ? ` (${status})` : ''}`,
    );
    this.name = 'CostServerError';
  }
}

const TIMEOUT_MS = 15_000;

type Conn = { url: string; email: string; key: string };

const Budget = z
  .object({ monthlyEur: z.number(), monthStartDay: z.number() })
  .nullable();
const HelloSchema = z.object({
  server: z.literal('shellie-cost'),
  developer: z.object({
    email: z.string(),
    budgets: z.object({ claude: Budget, copilot: Budget }),
  }),
});
const RecordsSchema = z.object({
  server: z.string().optional(),
  accepted: z.number(),
});

async function call(
  c: Conn,
  path: string,
  init: { method: 'GET' | 'POST'; body?: string },
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetchImpl(`${c.url.replace(/\/+$/, '')}${path}`, {
        method: init.method,
        body: init.body,
        signal: ctl.signal,
        headers: {
          Authorization: `Bearer ${c.key}`,
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
    } catch {
      throw new CostServerError('network');
    }
    if (res.status === 401 || res.status === 403)
      throw new CostServerError('auth', res.status);
    if (res.status >= 500) throw new CostServerError('server', res.status);
    if (!res.ok) throw new CostServerError('rejected', res.status);
    try {
      return await res.json();
    } catch {
      throw new CostServerError('rejected', res.status);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Asks the server who the key and email belong to, and for the developer's budgets. */
export async function hello(
  c: Conn,
  fetchImpl: typeof fetch = fetch,
): Promise<{ email: string; budgets: ServerBudgets }> {
  const body = await call(
    c,
    `/api/v1/hello?email=${encodeURIComponent(c.email)}`,
    { method: 'GET' },
    fetchImpl,
  );
  const parsed = HelloSchema.safeParse(body);
  if (!parsed.success) throw new CostServerError('rejected');
  return {
    email: parsed.data.developer.email,
    budgets: parsed.data.developer.budgets,
  };
}

/** Upserts records (at most 500 per call); returns how many the server accepted. */
export async function sendRecords(
  c: Conn,
  records: CostRecord[],
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const body = await call(
    c,
    '/api/v1/records',
    { method: 'POST', body: JSON.stringify({ records }) },
    fetchImpl,
  );
  const parsed = RecordsSchema.safeParse(body);
  if (!parsed.success) throw new CostServerError('rejected');
  return parsed.data.accepted;
}
