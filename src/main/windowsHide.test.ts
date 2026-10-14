import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');
// Direct child_process calls (imported names, not methods like pty.spawn or terminals.spawn).
const CALL =
  /(?<![.\w])(spawn|spawnSync|exec|execSync|execFile|execFileSync|execFileAsync|fork)\(/g;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory())
      return d.name === 'test-helpers' || d.name === 'renderer'
        ? []
        : sources(p);
    return /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : [];
  });
}

describe('child processes in the app', () => {
  it('pass windowsHide so Windows does not flash a console window', () => {
    const missing: string[] = [];
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8');
      if (!/from 'node:child_process'/.test(text)) continue;
      const calls = text.match(CALL)?.length ?? 0;
      const hidden = text.match(/windowsHide: true/g)?.length ?? 0;
      if (hidden < calls)
        missing.push(
          `${path.relative(SRC, file)}: ${calls} call(s), ${hidden} windowsHide`,
        );
    }
    expect(missing).toEqual([]);
  });
});
