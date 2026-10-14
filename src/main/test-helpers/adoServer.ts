import { createServer, type IncomingMessage, type Server } from 'node:http';

export type Reply = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: string;
};
export type Recorded = {
  method: string;
  path: string;
  auth: string | null;
  body: string;
};
type Handler = (req: Recorded) => Reply;

export type AdoServer = {
  url: string;
  requests: Recorded[];
  route(method: string, pathPrefix: string, reply: Reply | Handler): void;
  close(): Promise<void>;
};

/** A tiny HTTP server that answers Azure DevOps REST paths with canned JSON. Routes match by method and path prefix, last registered wins. */
export async function startAdoServer(): Promise<AdoServer> {
  const routes: { method: string; prefix: string; reply: Reply | Handler }[] =
    [];
  const requests: Recorded[] = [];
  const server: Server = createServer((req: IncomingMessage, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const rec: Recorded = {
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        auth: req.headers.authorization ?? null,
        body,
      };
      requests.push(rec);
      const route = [...routes]
        .reverse()
        .find((r) => r.method === rec.method && rec.path.startsWith(r.prefix));
      const reply: Reply = route
        ? typeof route.reply === 'function'
          ? route.reply(rec)
          : route.reply
        : {
            status: 404,
            body: { message: `no route for ${rec.method} ${rec.path}` },
          };
      res.writeHead(reply.status ?? 200, {
        'content-type': 'application/json',
        ...reply.headers,
      });
      res.end(reply.raw ?? JSON.stringify(reply.body ?? {}));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    route: (method, prefix, reply) => {
      routes.push({ method, prefix, reply });
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
