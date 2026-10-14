// Runs the packaged app in smoke mode (MIAC_SMOKE=1) and checks that it prints MIAC_SMOKE_OK and exits 0
// (or with an unknown exit code, see smokeVerdict.mjs).
// Usage: node tools/forge/smoke.mjs [path to the packaged executable]
// Without a path it finds out/*/MIAC.exe (Windows) or out/*/*.app/Contents/MacOS/MIAC (macOS).
// A hard timeout matters: when the main bundle cannot even load (a missing module), Electron shows a
// modal error dialog and never exits, so the process is killed and the check fails. A second deadline
// after the kill ends the check even when a helper process keeps the output pipes open.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { smokeVerdict } from './smokeVerdict.mjs';

const TIMEOUT_MS = 60_000;
const AFTER_KILL_MS = 10_000;
const DRAIN_MS = 5_000;

function findExe() {
  const out = path.resolve('out');
  const found = [];
  for (const dir of existsSync(out) ? readdirSync(out) : []) {
    const base = path.join(out, dir);
    const exe = path.join(base, 'MIAC.exe');
    if (process.platform === 'win32' && existsSync(exe)) found.push(exe);
    if (process.platform === 'darwin')
      for (const app of readdirSync(base).filter((f) => f.endsWith('.app'))) {
        const bin = path.join(base, app, 'Contents', 'MacOS', 'MIAC');
        if (existsSync(bin)) found.push(bin);
      }
  }
  if (found.length !== 1)
    throw new Error(
      `Expected one packaged MIAC under out/, found: ${found.join(', ') || 'none'}`,
    );
  return found[0];
}

const exe = process.argv[2] ?? findExe();
console.log(`smoke: ${exe}`);
const child = spawn(exe, [], {
  env: { ...process.env, MIAC_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let output = '';
for (const s of [child.stdout, child.stderr])
  s.on('data', (d) => {
    output += d.toString();
    process.stdout.write(d);
  });
let timedOut = false;
let done = false;
const finish = (code) => {
  if (done) return;
  done = true;
  clearTimeout(timer);
  if (timedOut)
    console.error(`smoke: no exit within ${TIMEOUT_MS / 1000} s (killed)`);
  const ok = smokeVerdict({ timedOut, code, output });
  console.log(`smoke: exit ${code}, ${ok ? 'passed' : 'FAILED'}`);
  process.exit(ok ? 0 : 1);
};
const timer = setTimeout(() => {
  timedOut = true;
  child.kill();
  setTimeout(() => {
    console.error(
      `smoke: still not closed ${AFTER_KILL_MS / 1000} s after the kill, FAILED`,
    );
    process.exit(1);
  }, AFTER_KILL_MS);
}, TIMEOUT_MS);
child.on('error', (e) => {
  clearTimeout(timer);
  console.error(`smoke: could not start: ${e.message}`);
  process.exit(1);
});
// `close` waits for the output pipes. If a helper process inherited them, decide shortly after `exit`.
child.on('exit', (code) => {
  setTimeout(() => finish(code), DRAIN_MS);
});
child.on('close', (code) => finish(code));
