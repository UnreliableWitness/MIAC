import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageEvent } from '../../shared/usage';
import type { ClaudeActive } from './otlp';
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
  it('hands active_time points of a metrics body to onActiveTime', async () => {
    const points: ClaudeActive[] = [];
    const r = new UsageReceiver(
      () => undefined,
      (p) => points.push(...p),
    );
    receivers.push(r);
    const port = await freePort();
    await r.start(port);
    const url = `http://127.0.0.1:${port}/v1/metrics`;
    const headers = { 'content-type': 'application/json' };
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: readFileSync(
        path.join(__dirname, '__fixtures__', 'claude', 'metrics.json'),
      ),
    });
    expect(res.status).toBe(200);
    expect(points).toHaveLength(1);
    const bad = await fetch(url, { method: 'POST', headers, body: '{nope' });
    expect(bad.status).toBe(400);
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
  it('never crashes on an absurd timestamp', async () => {
    const { got, port } = await start();
    const doc = JSON.parse(fixture.toString('utf8'));
    for (const rl of doc.resourceLogs)
      for (const sl of rl.scopeLogs)
        for (const rec of sl.logRecords) {
          rec.timeUnixNano = '1e30';
          rec.attributes = rec.attributes.filter(
            (a: { key: string }) => a.key !== 'event.timestamp',
          );
        }
    const res = await fetch(`http://127.0.0.1:${port}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(doc),
    });
    expect([200, 400]).toContain(res.status);
    const again = await fetch(`http://127.0.0.1:${port}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: fixture,
    });
    expect(again.status).toBe(200);
    expect(got.length).toBeGreaterThan(0);
  });
});

describe('POST /v1/attention', () => {
  const signals: [string, unknown][] = [];
  let r: UsageReceiver;
  let base: string;
  beforeEach(async () => {
    signals.length = 0;
    r = new UsageReceiver(() => undefined, undefined, {
      token: 'secret',
      onSignal: (id, s) => {
        if (id === 'unknown') return false;
        signals.push([id, s]);
        return true;
      },
    });
    receivers.push(r);
    const port = await freePort();
    expect((await r.start(port)).listening).toBe(true);
    base = `http://127.0.0.1:${port}`;
  });

  const post = (body: unknown, token = 'secret') =>
    fetch(`${base}/v1/attention`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shellie-token': token },
      body: JSON.stringify(body),
    });

  it('accepts a valid signal', async () => {
    const res = await post({
      terminalId: 't1',
      state: 'blocked',
      kind: 'permission',
      message: 'm',
    });
    expect(res.status).toBe(200);
    expect(signals).toEqual([
      ['t1', { state: 'blocked', kind: 'permission', message: 'm' }],
    ]);
  });

  it('rejects a wrong token, a bad body and an unknown terminal', async () => {
    expect(
      (await post({ terminalId: 't1', state: 'done' }, 'nope')).status,
    ).toBe(403);
    expect((await post({ terminalId: 't1', state: 'dancing' })).status).toBe(
      400,
    );
    expect((await post({ terminalId: 'unknown', state: 'done' })).status).toBe(
      404,
    );
    expect(signals).toEqual([]);
  });

  it('clamps the message', async () => {
    await post({ terminalId: 't1', state: 'done', message: 'x'.repeat(3000) });
    expect((signals[0][1] as { message: string }).message).toHaveLength(200);
  });
});

describe('/v1/run', () => {
  type Call = {
    taskId: string;
    name: string;
    args: string[];
    workspace?: string;
    terminal?: string;
    signal?: AbortSignal;
  };
  const calls: Call[] = [];
  let base: string;
  let release: () => void = () => undefined;
  beforeEach(async () => {
    calls.length = 0;
    const r = new UsageReceiver(() => undefined, undefined, undefined, {
      taskFor: (token) =>
        token === 'tok-a' ? 'task-a' : token === 'tok-b' ? 'task-b' : null,
      names: async (taskId, folder) =>
        taskId === 'task-a' ? ['dev', 'test', folder ?? '-'] : ['other'],
      start: async (taskId, name, args, out, o) => {
        calls.push({ taskId, name, args, ...o });
        if (name === 'hang') {
          await new Promise<void>((resolve) => {
            release = resolve;
            o?.signal?.addEventListener('abort', () => resolve());
          });
          return 1;
        }
        out('line one\n');
        out('no newline');
        return 3;
      },
    });
    receivers.push(r);
    const port = await freePort();
    expect((await r.start(port)).listening).toBe(true);
    base = `http://127.0.0.1:${port}`;
  });

  const post = (body: string, token = 'tok-a', type = 'application/json') =>
    fetch(`${base}/v1/run`, {
      method: 'POST',
      headers: { 'content-type': type, authorization: `Bearer ${token}` },
      body,
    });

  it('streams the output and ends with the exit line', async () => {
    const res = await post(
      JSON.stringify({
        name: 'dev',
        args: ['--port', '5000'],
        workspace: '/w/app',
        terminal: 't1',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('line one\nno newline\n\u0000exit:3\n');
    expect(calls).toEqual([
      {
        taskId: 'task-a',
        name: 'dev',
        args: ['--port', '5000'],
        workspace: '/w/app',
        terminal: 't1',
        signal: expect.any(AbortSignal),
      },
    ]);
  });

  it('takes a form body (the sh shim) with repeated arg fields', async () => {
    const form = new URLSearchParams([
      ['name', 'dev'],
      ['arg', 'a b'],
      ['arg', '$(x)&y'],
      ['workspace', '/w/app'],
    ]);
    const res = await post(
      form.toString(),
      'tok-a',
      'application/x-www-form-urlencoded',
    );
    expect(res.status).toBe(200);
    await res.text();
    expect(calls[0]).toMatchObject({
      name: 'dev',
      args: ['a b', '$(x)&y'],
      workspace: '/w/app',
    });
  });

  it("runs a token's own task only", async () => {
    await (await post(JSON.stringify({ name: 'dev' }), 'tok-b')).text();
    expect(calls.map((c) => c.taskId)).toEqual(['task-b']);
  });

  it('refuses a wrong or missing token with 401 and runs nothing', async () => {
    expect((await post(JSON.stringify({ name: 'dev' }), 'nope')).status).toBe(
      401,
    );
    const bare = await fetch(`${base}/v1/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'dev' }),
    });
    expect(bare.status).toBe(401);
    const list = await fetch(`${base}/v1/run`, {
      headers: { authorization: 'Bearer nope' },
    });
    expect(list.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('refuses a bad body with 400', async () => {
    expect((await post('{"name": 3}')).status).toBe(400);
    expect(
      (await post(JSON.stringify({ name: 'dev', args: [1] }))).status,
    ).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect((await post('x', 'tok-a', 'text/plain')).status).toBe(415);
    expect(calls).toEqual([]);
  });

  it('lists the names on GET', async () => {
    const res = await fetch(`${base}/v1/run?workspace=%2Fw%2Fapi`, {
      headers: { authorization: 'Bearer tok-a' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      'Commands for shellie run: dev, test, /w/api\n\u0000exit:0\n',
    );
  });

  it('tells the run when the caller goes away', async () => {
    const ac = new AbortController();
    const res = fetch(`${base}/v1/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer tok-a',
      },
      body: JSON.stringify({ name: 'hang' }),
      signal: ac.signal,
    }).catch(() => null);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    ac.abort();
    await res;
    await vi.waitFor(() => expect(calls[0]!.signal!.aborted).toBe(true));
    release();
  });
});
