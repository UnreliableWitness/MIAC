import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { gunzipSync } from 'node:zlib';
import {
  AttentionPostSchema,
  clampMessage,
  type AttentionSignal,
} from '../../shared/attention';
import type { UsageEvent } from '../../shared/usage';
import {
  type ClaudeActive,
  parseClaudeActiveTime,
  parseClaudeLogs,
} from './otlp';

const LIMIT = 5 * 1024 * 1024;
type Status = { listening: boolean; port: number; error: string | null };

/** OTLP/HTTP JSON endpoint on 127.0.0.1 for Claude Code log events, and the attention route for the OpenCode plugin. */
export class UsageReceiver {
  private server: Server | null = null;
  private current: Status = { listening: false, port: 0, error: null };

  constructor(
    private readonly onEvents: (events: UsageEvent[]) => void,
    private readonly onActiveTime?: (points: ClaudeActive[]) => void,
    private readonly attention?: {
      token: string;
      onSignal: (terminalId: string, s: AttentionSignal) => boolean;
    },
  ) {}

  get status(): Status {
    return this.current;
  }

  async start(port: number): Promise<Status> {
    await this.stop();
    const server = createServer((req, res) => this.handle(req, res));
    this.current = await new Promise<Status>((resolve) => {
      server.once('error', (e: NodeJS.ErrnoException) => {
        resolve({
          listening: false,
          port,
          error:
            e.code === 'EADDRINUSE'
              ? `Port ${port} is in use by another program`
              : e.message,
        });
      });
      server.listen(port, '127.0.0.1', () =>
        resolve({ listening: true, port, error: null }),
      );
    });
    this.server = this.current.listening ? server : null;
    return this.current;
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    this.current = { ...this.current, listening: false };
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const reply = (status: number, body = '{}') => {
      if (res.headersSent) return;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    };
    const path = (req.url ?? '').split('?')[0];
    const isAttention =
      path === '/v1/attention' && this.attention !== undefined;
    if (!isAttention && path !== '/v1/logs' && path !== '/v1/metrics')
      return reply(404);
    if (req.method !== 'POST') return reply(405);
    if (
      isAttention &&
      req.headers['x-shellie-token'] !== this.attention!.token
    ) {
      req.resume();
      return reply(403);
    }
    if (
      !(req.headers['content-type'] ?? '')
        .toLowerCase()
        .startsWith('application/json')
    ) {
      req.resume();
      return reply(415);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > LIMIT) {
        tooBig = true;
        reply(413);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return;
      if (isAttention) {
        let body: ReturnType<typeof AttentionPostSchema.parse>;
        try {
          body = AttentionPostSchema.parse(
            JSON.parse(Buffer.concat(chunks).toString('utf8')),
          );
        } catch {
          return reply(400);
        }
        const { terminalId, state, kind } = body;
        const message = body.message ? clampMessage(body.message) : '';
        const known = this.attention!.onSignal(terminalId, {
          state,
          ...(kind ? { kind } : {}),
          ...(message ? { message } : {}),
        });
        return reply(known ? 200 : 404);
      }
      let events: UsageEvent[] = [];
      let skipped = 0;
      let active: ClaudeActive[] = [];
      try {
        let buf = Buffer.concat(chunks);
        if ((req.headers['content-encoding'] ?? '').toLowerCase() === 'gzip')
          buf = gunzipSync(buf, { maxOutputLength: LIMIT });
        const doc: unknown = JSON.parse(buf.toString('utf8'));
        if (path === '/v1/metrics') active = parseClaudeActiveTime(doc);
        else ({ events, skipped } = parseClaudeLogs(doc));
      } catch (e) {
        const tooLarge =
          (e as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE' ||
          (e instanceof RangeError && /larger|size/i.test(e.message));
        return reply(tooLarge ? 413 : 400);
      }
      if (skipped > 0)
        console.warn(
          `[usage] skipped ${skipped} api_request record(s) without a model or request id`,
        );
      try {
        if (events.length > 0) this.onEvents(events);
        if (active.length > 0) this.onActiveTime?.(active);
      } catch (e) {
        console.error('[usage] failed to handle usage data', e);
        return reply(500);
      }
      reply(200);
    });
  }
}
