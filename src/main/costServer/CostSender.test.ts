import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CostRecord } from '../../shared/ledger';
import { CostSender } from './CostSender';
import { CostServerError } from './client';

const conn = { url: 'https://cost.example', email: 'a@b.c', key: 'k' };
const rec = (id: string, at = '2026-10-01T00:00:00Z') =>
  ({ id, at }) as CostRecord;
const budgets = { claude: null, copilot: null };

function make(ids: string[], connection: typeof conn | null = conn) {
  const sent = new Set<string>();
  const records = ids.map((id, i) =>
    rec(
      id,
      `2026-10-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
    ),
  );
  const ledger = {
    dirty: vi.fn((limit: number) =>
      records.filter((r) => !sent.has(r.id)).slice(0, limit),
    ),
    markSent: vi.fn(async (rs: CostRecord[]) => {
      for (const r of rs) sent.add(r.id);
    }),
    resetSent: vi.fn(async () => sent.clear()),
  };
  const server = {
    get: vi.fn((): typeof conn | null => connection),
    budgets: null as typeof budgets | null,
    setBudgets: vi.fn(async () => {}),
  };
  const send = vi.fn(async (_c: unknown, rs: CostRecord[]) => rs.length);
  const hello = vi.fn(async () => ({ email: 'a@b.c', budgets }));
  const notice = vi.fn();
  const telemetry = vi.fn();
  const sender = new CostSender({
    ledger,
    server,
    send: send as never,
    hello: hello as never,
    status: vi.fn(),
    notice,
    telemetry,
  });
  return { sender, ledger, server, send, hello, notice, telemetry, sent };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('CostSender', () => {
  it('sends dirty records in batches of 500, oldest first', async () => {
    const t = make(Array.from({ length: 1200 }, (_, i) => `cc:${i}`));
    t.sender.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.send.mock.calls.map((c) => c[1].length)).toEqual([500, 500, 200]);
    expect(t.send.mock.calls[0]![1][0]!.id).toBe('cc:0');
    expect(t.sent.size).toBe(1200);
    expect(t.server.setBudgets).toHaveBeenCalledWith(budgets);
    t.sender.stop();
  });

  it('keeps records and backs off while the server is down, then catches up', async () => {
    const t = make(['cc:1', 'cc:2']);
    const fail = () => Promise.reject(new CostServerError('network'));
    t.send
      .mockImplementationOnce(fail)
      .mockImplementationOnce(fail)
      .mockImplementationOnce(fail);
    t.sender.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.sent.size).toBe(0);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(t.send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000); // 1 min
    expect(t.send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(t.send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000); // 2 min
    expect(t.send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(240_000); // 4 min
    expect(t.send).toHaveBeenCalledTimes(4);
    expect(t.sent).toEqual(new Set(['cc:1', 'cc:2']));
    expect(t.telemetry).toHaveBeenCalledWith('costServer.sendFailed', {
      kind: 'network',
      status: 0,
    });
    t.sender.stop();
  });

  it('stops and tells once on a refused key', async () => {
    const t = make(['cc:1']);
    t.send.mockRejectedValue(new CostServerError('auth', 401));
    t.sender.start();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    t.sender.kick();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.notice).toHaveBeenCalledTimes(1);
    expect(t.notice).toHaveBeenCalledWith(
      'Your cost server refused the key. Check Settings › Cost server.',
    );
    expect(t.sender.status().error).toBe('The server refused the key');
    t.send.mockImplementation(async (_c, rs) => rs.length);
    await t.sender.onConnected();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.sent.size).toBe(1);
    t.sender.stop();
  });

  it('skips one bad record without blocking the rest', async () => {
    const t = make(['cc:1', 'cc:bad', 'cc:3']);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    t.send.mockImplementation(async (_c, rs) => {
      if (rs.some((r) => r.id === 'cc:bad'))
        throw new CostServerError('rejected', 400);
      return rs.length;
    });
    t.sender.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.sent).toEqual(new Set(['cc:1', 'cc:3']));
    expect(warn.mock.calls.flat().join(' ')).toContain('cc:bad');
    t.sender.stop();
    warn.mockRestore();
  });

  it('backfills everything after connecting', async () => {
    const t = make(['cc:1', 'cc:2']);
    t.sent.add('cc:1');
    t.sent.add('cc:2');
    await t.sender.onConnected();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.ledger.resetSent).toHaveBeenCalled();
    expect(t.sent.size).toBe(2);
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.hello).toHaveBeenCalledTimes(1);
    t.sender.stop();
  });

  it('says hello on the first pass after start, once per pass', async () => {
    const t = make(['cc:1']);
    t.server.budgets = budgets;
    t.sender.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.hello).toHaveBeenCalledTimes(1);
    expect(t.server.setBudgets).toHaveBeenCalledWith(budgets);
    t.sender.kick();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.hello).toHaveBeenCalledTimes(1);
    t.sender.stop();
  });

  it('sends records again to a new server when it changes mid-send', async () => {
    const t = make(['cc:1', 'cc:2']);
    let release: () => void = () => {};
    t.send.mockImplementationOnce(
      (_c, rs) =>
        new Promise<number>((resolve) => {
          release = () => resolve(rs.length);
        }),
    );
    t.sender.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.send).toHaveBeenCalledTimes(1);
    const next = { ...conn, url: 'https://new.example' };
    t.server.get.mockReturnValue(next);
    await t.sender.onConnected();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.sent.size).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.send).toHaveBeenCalledTimes(2);
    expect(t.send.mock.calls[1]![0]).toEqual(next);
    expect(t.sent).toEqual(new Set(['cc:1', 'cc:2']));
    t.sender.stop();
  });

  it('does nothing without a connection', async () => {
    const t = make(['cc:1'], null);
    t.sender.start();
    await vi.advanceTimersByTimeAsync(30_000);
    t.sender.kick();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.send).not.toHaveBeenCalled();
    expect(t.hello).not.toHaveBeenCalled();
    expect(t.sender.status().connected).toBe(false);
    t.sender.stop();
  });
});
