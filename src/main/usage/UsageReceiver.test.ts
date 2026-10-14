import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UsageEvent } from '../../shared/usage';
import { UsageReceiver } from './UsageReceiver';

const receivers: UsageReceiver[] = [];
afterEach(async () => {
  await Promise.all(receivers.splice(0).map((r) => r.stop()));
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
async function start() {
  const got: UsageEvent[] = [];
  const r = new UsageReceiver((events) => got.push(...events));
  receivers.push(r);
  const port = await freePort();
  const status = await r.start(port);
  return { r, got, port, status };
}
const fixture = readFileSync(
  path.join(__dirname, '__fixtures__', 'claude', 'api-request-logs.json'),
);

describe('UsageReceiver', () => {
  it('accepts the recorded Claude Code body and hands over events', async () => {
    const { got, port, status } = await start();
    expect(status).toEqual({ listening: true, port, error: null });
    const res = await fetch(`http://127.0.0.1:${port}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: fixture,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(got.length).toBeGreaterThan(0);
  });
  it('accepts gzip bodies', async () => {
    const { got, port } = await start();
    const res = await fetch(`http://127.0.0.1:${port}/v1/logs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      body: gzipSync(fixture),
    });
    expect(res.status).toBe(200);
    expect(got.length).toBeGreaterThan(0);
  });
  it('accepts and ignores metrics', async () => {
    const { got, port } = await start();
    const res = await fetch(`http://127.0.0.1:${port}/v1/metrics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"resourceMetrics":[]}',
    });
    expect(res.status).toBe(200);
    expect(got).toEqual([]);
  });
  it('rejects protobuf, bad JSON, oversized bodies and unknown paths', async () => {
    const { port } = await start();
    const post = (
      p: string,
      type: string,
      b: string | Uint8Array<ArrayBuffer>,
    ) =>
      fetch(`http://127.0.0.1:${port}${p}`, {
        method: 'POST',
        headers: { 'content-type': type },
        body: b,
      });
    expect((await post('/v1/logs', 'application/x-protobuf', 'x')).status).toBe(
      415,
    );
    expect((await post('/v1/logs', 'application/json', '{nope')).status).toBe(
      400,
    );
    expect(
      (
        await post(
          '/v1/logs',
          'application/json',
          new Uint8Array(5 * 1024 * 1024 + 1),
        )
      ).status,
    ).toBe(413);
    expect((await post('/v1/traces', 'application/json', '{}')).status).toBe(
      404,
    );
    expect((await fetch(`http://127.0.0.1:${port}/v1/logs`)).status).toBe(405);
  });
  it('reports a port in use instead of throwing, and can move to another port', async () => {
    const a = await start();
    const b = new UsageReceiver(() => {});
    receivers.push(b);
    const status = await b.start(a.port);
    expect(status.listening).toBe(false);
    expect(status.error).toMatch(/in use/i);
    const other = await freePort();
    expect(await b.start(other)).toEqual({
      listening: true,
      port: other,
      error: null,
    });
  });
  it('rejects a small gzip body that inflates past the limit', async () => {
    const { got, port } = await start();
    const res = await fetch(`http://127.0.0.1:${port}/v1/logs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
      },
      body: gzipSync(Buffer.alloc(6 * 1024 * 1024, 0x20)),
    });
    expect(res.status).toBe(413);
    expect(got).toEqual([]);
  });
  it('answers 500 when the handler throws and keeps serving', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = new UsageReceiver(() => {
      throw new Error('boom');
    });
    receivers.push(r);
    const port = await freePort();
    await r.start(port);
    const send = () =>
      fetch(`http://127.0.0.1:${port}/v1/logs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: fixture,
      });
    expect((await send()).status).toBe(500);
    expect((await send()).status).toBe(500);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
