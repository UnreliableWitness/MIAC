import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CostRecord } from '../../shared/ledger';
import { CostServerError, hello, sendRecords } from './client';

const c = { url: 'https://cost.example/', email: 'a@b.c', key: 'secret-key' };
const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status });
const helloBody = {
  server: 'shellie-cost',
  version: '1',
  developer: {
    email: 'a@b.c',
    budgets: { claude: { monthlyEur: 100, monthStartDay: 5 }, copilot: null },
  },
};

afterEach(() => vi.useRealTimers());

describe('cost server client', () => {
  it('sends the bearer key and parses budgets', async () => {
    const f = vi.fn(async () => json(200, helloBody));
    const r = await hello(c, f as unknown as typeof fetch);
    expect(r).toEqual({
      email: 'a@b.c',
      budgets: helloBody.developer.budgets,
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://cost.example/api/v1/hello?email=a%40b.c');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer secret-key',
    );
    const g = vi.fn(async () => json(200, { accepted: 2 }));
    const records = [{ id: 'cc:1' }] as CostRecord[];
    expect(await sendRecords(c, records, g as unknown as typeof fetch)).toBe(2);
    const [u2, i2] = g.mock.calls[0] as unknown as [string, RequestInit];
    expect(u2).toBe('https://cost.example/api/v1/records');
    expect(i2.method).toBe('POST');
    expect(JSON.parse(i2.body as string)).toEqual({ records });
  });

  it('maps 401 to auth, 503 to server, 400 to rejected, a thrown fetch to network', async () => {
    const kind = async (f: () => Promise<Response>) =>
      hello(c, f as unknown as typeof fetch).catch((e) => e);
    const a = await kind(async () => json(401));
    expect(a).toBeInstanceOf(CostServerError);
    expect(a).toMatchObject({ kind: 'auth', status: 401 });
    expect(await kind(async () => json(403))).toMatchObject({ kind: 'auth' });
    expect(await kind(async () => json(503))).toMatchObject({
      kind: 'server',
      status: 503,
    });
    expect(await kind(async () => json(400))).toMatchObject({
      kind: 'rejected',
      status: 400,
    });
    const n = await kind(async () => {
      throw new TypeError('fetch failed secret-key');
    });
    expect(n).toMatchObject({ kind: 'network' });
    expect(String(n.message)).not.toContain('secret-key');
  });

  it('times out after 15 s', async () => {
    vi.useFakeTimers();
    const f = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init.signal!.addEventListener('abort', () =>
            rej(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const p = hello(c, f as unknown as typeof fetch).catch((e) => e);
    await vi.advanceTimersByTimeAsync(14_999);
    let settled = false;
    void p.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toMatchObject({ kind: 'network' });
  });

  it('rejects a server that is not shellie-cost', async () => {
    const f = async () => json(200, { ...helloBody, server: 'other' });
    await expect(hello(c, f as unknown as typeof fetch)).rejects.toMatchObject({
      kind: 'rejected',
    });
    const g = async () => json(200, { nonsense: true });
    await expect(
      sendRecords(c, [], g as unknown as typeof fetch),
    ).rejects.toMatchObject({ kind: 'rejected' });
  });
});

describe('cost server client redirects', () => {
  it('never follows a redirect, so the key stays with the server it was given for', async () => {
    const f = vi.fn(async (_u: string, _init?: RequestInit) => {
      throw new TypeError('redirect');
    });
    await expect(hello(c, f as unknown as typeof fetch)).rejects.toMatchObject({
      kind: 'network',
    });
    expect(f.mock.calls[0]![1]?.redirect).toBe('error');
  });
});
