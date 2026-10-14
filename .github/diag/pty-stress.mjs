// TEMPORARY diagnostic: churn node-pty on Windows to provoke the native crash.
// Usage: node pty-stress.mjs <dll|system> <seconds>
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pty = require('node-pty');
const useConptyDll = process.argv[2] !== 'system';
const seconds = Number(process.argv[3] ?? 20);
const end = Date.now() + seconds * 1000;
let spawned = 0;
let exited = 0;
let inFlight = 0;
const MAX = 12;

function one() {
  inFlight++;
  spawned++;
  const kill = spawned % 3 === 0;
  const p = pty.spawn('cmd.exe', kill ? [] : ['/c', 'echo', 'x'], {
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
    useConptyDll,
  });
  p.onData(() => {});
  p.onExit(() => {
    exited++;
    inFlight--;
  });
  if (kill) setTimeout(() => p.kill(), 50 + (spawned % 7) * 20);
}

const t = setInterval(() => {
  if (Date.now() > end) {
    clearInterval(t);
    const wait = setInterval(() => {
      if (inFlight <= 0 || Date.now() > end + 15000) {
        clearInterval(wait);
        console.log(`done: spawned=${spawned} exited=${exited} inFlight=${inFlight}`);
        process.exit(0);
      }
    }, 100);
    return;
  }
  while (inFlight < MAX) one();
}, 10);
