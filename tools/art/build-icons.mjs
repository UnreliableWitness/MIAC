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
// The SVGs place the picked Gemini picture (shellie-art.jpg); resvg gets it inlined as a data URL.
const art = `data:image/jpeg;base64,${readFileSync(path.join(dir, 'shellie-art.jpg')).toString('base64')}`;
const read = (name) =>
  readFileSync(path.join(dir, name), 'utf8').replace(
    'href="shellie-art.jpg"',
    `href="${art}"`,
  );
const windows = { big: read('shellie.svg'), small: read('shellie-small.svg') };
const mac = {
  big: read('shellie-mac.svg'),
  small: read('shellie-mac-small.svg'),
};
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

// Each SVG draws its platform's whole icon: Windows on a near-full-bleed tile, macOS on Apple's grid (a tile of
// 824 of 1024, centred). 16-32 px use the -small drawings, cropped closer to the shell.
const render = (set, size) =>
  Buffer.from(
    new Resvg(size <= 32 ? set.small : set.big, {
      fitTo: { mode: 'width', value: size },
    })
      .render()
      .asPng(),
  );

mkdirSync(path.join(dir, 'png'), { recursive: true });
const pngs = new Map(SIZES.map((s) => [s, render(windows, s)]));
for (const [s, png] of pngs)
  writeFileSync(path.join(dir, 'png', `${s}.png`), png);
writeFileSync(
  path.join(dir, 'shellie.ico'),
  buildIco(
    [16, 24, 32, 48, 64, 128, 256].map((size) => ({
      size,
      png: pngs.get(size),
    })),
  ),
);
console.log('wrote png/*.png and shellie.ico');

if (process.platform !== 'darwin') {
  console.error(
    'build-icons: shellie.icns needs macOS iconutil, so it was NOT updated (png/*.png and shellie.ico were). Run `npm run icons` on a Mac before committing, so the three stay in step.',
  );
  process.exit(1);
}
const tmp = mkdtempSync(path.join(os.tmpdir(), 'shellie-icns-'));
const set = path.join(tmp, 'shellie.iconset');
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
  writeFileSync(path.join(set, `icon_${name}.png`), render(mac, size));
execFileSync('iconutil', [
  '-c',
  'icns',
  set,
  '-o',
  path.join(dir, 'shellie.icns'),
]);
rmSync(tmp, { recursive: true, force: true });
console.log('wrote shellie.icns');
