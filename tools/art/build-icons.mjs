// Renders assets/icon/*.svg to PNGs, a Windows .ico and a macOS .icns. Outputs are committed.
// The .icns needs macOS iconutil: elsewhere the PNGs and .ico are written and the script exits 1.
import { execFileSync } from 'node:child_process';
import {
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

// The SVGs draw the mark in the 384-unit block at 64,64. Windows icons fill their square, so the PNGs and .ico crop
// to the block (stripes stay on the pixel grid: 4 px at 16 px). macOS icons sit on Apple's grid (824 of 1024), so
// the .icns keeps a margin from 48 px up; its 16 and 32 px keep the SVG's own margin (3 px stripes at 16 px).
const WINDOWS = '64 64 384 384';
const MAC = '18 18 476 476';
const render = (size, viewBox) => {
  const svg = (size <= 32 ? small : big).replace(
    /viewBox="[^"]*"/,
    `viewBox="${viewBox ?? '0 0 512 512'}"`,
  );
  return Buffer.from(
    new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng(),
  );
};

mkdirSync(path.join(dir, 'png'), { recursive: true });
const pngs = new Map(SIZES.map((s) => [s, render(s, WINDOWS)]));
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
    'build-icons: miac.icns needs macOS iconutil, so it was NOT updated (png/*.png and miac.ico were). Run `npm run icons` on a Mac before committing, so the three stay in step.',
  );
  process.exit(1);
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
  writeFileSync(
    path.join(set, `icon_${name}.png`),
    render(size, size <= 32 ? null : MAC),
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
