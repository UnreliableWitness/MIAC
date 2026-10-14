// Renders assets/icon/*.svg to PNGs, a Windows .ico and (on macOS) a .icns. Outputs are committed.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { buildIco } from './ico.mjs';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const dir = path.join(root, 'assets/icon');
const big = readFileSync(path.join(dir, 'miac.svg'), 'utf8');
const small = readFileSync(path.join(dir, 'miac-small.svg'), 'utf8');
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

const render = (size) =>
  Buffer.from(
    new Resvg(size <= 32 ? small : big, {
      fitTo: { mode: 'width', value: size },
    })
      .render()
      .asPng(),
  );

mkdirSync(path.join(dir, 'png'), { recursive: true });
const pngs = new Map(SIZES.map((s) => [s, render(s)]));
for (const [s, png] of pngs)
  writeFileSync(path.join(dir, 'png', `${s}.png`), png);
writeFileSync(
  path.join(dir, 'miac.ico'),
  buildIco(
    [16, 24, 32, 48, 64, 128, 256].map((size) => ({
      size,
      png: pngs.get(size),
    })),
  ),
);
console.log('wrote png/*.png and miac.ico');

if (process.platform !== 'darwin') {
  console.error(
    'miac.icns needs macOS iconutil; skipped. Commit the .icns from a Mac.',
  );
  process.exit(0);
}
const tmp = mkdtempSync(path.join(os.tmpdir(), 'miac-icns-'));
const set = path.join(tmp, 'miac.iconset');
mkdirSync(set);
for (const [name, size] of [
  ['16x16', 16],
  ['16x16@2x', 32],
  ['32x32', 32],
  ['32x32@2x', 64],
  ['128x128', 128],
  ['128x128@2x', 256],
  ['256x256', 256],
  ['256x256@2x', 512],
  ['512x512', 512],
  ['512x512@2x', 1024],
])
  copyFileSync(
    path.join(dir, 'png', `${size}.png`),
    path.join(set, `icon_${name}.png`),
  );
execFileSync('iconutil', [
  '-c',
  'icns',
  set,
  '-o',
  path.join(dir, 'miac.icns'),
]);
rmSync(tmp, { recursive: true, force: true });
console.log('wrote miac.icns');
