#!/usr/bin/env node
// node tools/telemetry/record-otlp.mjs <outDir> [port]
// Listens on 127.0.0.1:<port> (default 4399) and writes every POST body to <outDir>/<n>-<path>.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const [outDir, portArg] = process.argv.slice(2);
if (!outDir) {
  console.error('Usage: record-otlp.mjs <outDir> [port]');
  process.exit(64);
}
mkdirSync(outDir, { recursive: true });
const port = Number(portArg || 4399);
let n = 0;
createServer((req, res) => {
  let body = '';
  req.on('data', (c) => {
    body += c;
  });
  req.on('end', () => {
    const name = `${String(++n).padStart(3, '0')}-${(req.url || '/').replace(/[^a-z0-9]+/gi, '_')}.json`;
    writeFileSync(path.join(outDir, name), body);
    console.log(
      `${req.method} ${req.url} ${req.headers['content-type']} ${body.length}B -> ${name}`,
    );
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
}).listen(port, '127.0.0.1', () =>
  console.log(`recording on http://127.0.0.1:${port}`),
);
