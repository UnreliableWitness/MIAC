// Writes the four conch drawings in assets/icon/*.svg; then `npm run icons` renders them. Edit the shapes here, not
// in the SVGs. The in-app MindMark copies the small drawing's faces by hand.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The conch in a 512 box, upright around x 256: a spire of bulging whorls over a wide body whorl, its opening on the
// right with a cursor glowing inside. Lit from the upper left: each whorl has a lit, a mid and a shaded face.
function conch({ cursor = true, small = false } = {}) {
  const C = {
    lit: '#e3f1fd',
    a: '#cfe6fb',
    b: '#a9d2f5',
    c: '#7fb8ec',
    d: '#5ca9f2',
    e: '#2b88d8',
    f: '#0f6cbd',
    hole: '#071a31',
    hole2: '#0d2c52',
  };
  const poly = (pts, fill) =>
    `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${fill}" stroke="${fill}" stroke-width="1.2" stroke-linejoin="round"/>`;
  const cx = 256,
    gap = small ? 14 : 6;
  // Whorls: [yTop, yBottom, halfTop, halfBulge]; the widest point sits 65% down, then tucks in a little.
  const tiers = small
    ? [
        [70, 160, 0, 52],
        [160, 250, 46, 100],
      ]
    : [
        [70, 112, 0, 22],
        [112, 154, 20, 44],
        [154, 200, 40, 70],
        [200, 250, 64, 98],
      ];
  let s = '';
  tiers.forEach(([y0, y1, h0, h1], i) => {
    const t = y0 + (i ? gap / 2 : 0),
      b = y1 - gap / 2,
      yb = t + (b - t) * 0.65,
      hb = h1 * 0.94;
    const L = (h, y) => [cx - h, y],
      R = (h, y) => [cx + h, y];
    const mx = (f) => cx - 0.15 * h1 + f;
    if (h0 === 0) {
      s += poly([[cx, t], L(h1, yb), [mx(0), b], [mx(0), yb]], C.a);
      s += poly([[cx, t], [mx(0), yb], R(h1, yb)], C.c);
    } else {
      s += poly([L(h0, t), [mx(-4), t], [mx(0), yb], L(h1, yb)], C.a);
      s += poly([[mx(-4), t], R(h0, t), R(h1, yb), [mx(0), yb]], C.c);
    }
    s += poly([L(h1, yb), [mx(0), yb], [mx(0), b], L(hb, b)], C.b); // underside, left
    s += poly([[mx(0), yb], R(h1, yb), R(hb, b), [mx(0), b]], C.e); // underside, right
  });
  const top = 250 + gap / 2;
  // Body whorl.
  const P = {
    tl: [cx - 104, top],
    tm: [cx - 16, top],
    tr: [cx + 98, top],
    sh: [cx + 118, 296],
    l: [cx - 120, 322],
    lm: [cx - 40, 336],
    m: [cx + 30, 312],
    bl: [cx - 72, 408],
    bm: [cx - 14, 406],
    cb: [cx + 6, 466],
  };
  const p = (...ks) => ks.map((k) => P[k]);
  if (small) {
    // Two faces only, so 16 px still shows a lit and a shaded side.
    s += poly(p('tl', 'tm', 'lm', 'bl', 'l'), C.a);
    s += poly(p('tm', 'tr', 'sh', 'm', 'bm', 'bl', 'lm'), C.c);
    s += poly(p('bl', 'bm', 'cb'), C.c);
  } else {
    s += poly(p('tl', 'tm', 'lm', 'l'), C.lit);
    s += poly(p('tm', 'm', 'lm'), C.a);
    s += poly(p('tm', 'tr', 'm'), C.b);
    s += poly(p('tr', 'sh', 'm'), C.d);
    s += poly(p('l', 'lm', 'bl'), C.a);
    s += poly(p('lm', 'bm', 'bl'), C.b);
    s += poly(p('lm', 'm', 'bm'), C.c);
    s += poly(p('bl', 'bm', 'cb'), C.c);
  }
  // Opening: a flared outer lip, a dark hollow, and the inner lip running down to the canal.
  s += poly(
    [
      [cx + 30, 312],
      [cx + 118, 296],
      [cx + 136, 370],
      [cx + 116, 432],
      [cx + 62, 468],
      [cx + 6, 466],
      [cx - 14, 406],
    ],
    C.e,
  );
  if (small) {
    s += poly(
      [
        [cx + 36, 326],
        [cx + 106, 316],
        [cx + 118, 372],
        [cx + 100, 424],
        [cx + 58, 452],
        [cx + 28, 432],
        [cx + 20, 380],
      ],
      C.hole,
    );
  } else {
    s += poly(
      [
        [cx + 118, 296],
        [cx + 136, 370],
        [cx + 116, 432],
        [cx + 102, 424],
        [cx + 118, 368],
        [cx + 104, 312],
      ],
      C.f,
    );
    s += poly(
      [
        [cx + 40, 330],
        [cx + 100, 320],
        [cx + 112, 372],
        [cx + 96, 420],
        [cx + 58, 450],
        [cx + 30, 432],
        [cx + 22, 380],
      ],
      C.hole2,
    );
    s += poly(
      [
        [cx + 46, 346],
        [cx + 92, 338],
        [cx + 100, 376],
        [cx + 86, 414],
        [cx + 58, 434],
        [cx + 38, 418],
        [cx + 34, 380],
      ],
      C.hole,
    );
  }
  s += poly(
    [
      [cx - 14, 406],
      [cx + 22, 380],
      [cx + 30, 432],
      [cx + 6, 466],
    ],
    C.a,
  );
  if (cursor) {
    const w = small ? 26 : 11,
      h = small ? 64 : 38,
      x = cx + 66,
      y = 384;
    s += `<rect x="${x - w * 1.5}" y="${y - h / 2 - 8}" width="${w * 3}" height="${h + 16}" rx="${w}" fill="#5ca9f2" opacity=".45" filter="url(#cglow)"/>`;
    s += `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${w / 3}" fill="#ffffff"/>`;
  }
  return s;
}
const cursorGlow = `<filter id="cglow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="8"/></filter>`;

const dir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../assets/icon',
);
const grad = (a, b) =>
  `<linearGradient id="deep" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const glow = `<radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#2b88d8" stop-opacity=".32"/><stop offset="1" stop-color="#2b88d8" stop-opacity="0"/></radialGradient>`;
const shell = (o, t) => `<g transform="${t}">${conch(o)}</g>`;
const out = {
  'shellie.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Windows, 48 px and up: a faceted conch standing upright, a cursor glowing in its opening, on a near-full-bleed
       deep-blue tile. -->
  <defs>${grad('#123a66', '#061427')}${glow}${cursorGlow}</defs>
  <rect x="16" y="16" width="480" height="480" rx="72" fill="url(#deep)"/>
  <circle cx="256" cy="240" r="210" fill="url(#glow)"/>
  ${shell({}, 'rotate(-6 256 262) translate(256 262) scale(.98) translate(-266 -268)')}
</svg>
`,
  'shellie-small.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Windows, 16-32 px: the same conch with fewer, bolder whorls and a thicker cursor, on the tile without glow. -->
  <defs>${grad('#164475', '#071a31')}${cursorGlow}</defs>
  <rect x="0" y="0" width="512" height="512" rx="88" fill="url(#deep)"/>
  ${shell({ small: true }, 'rotate(-6 256 262) translate(256 262) scale(1.08) translate(-266 -268)')}
</svg>
`,
  'shellie-mac.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- macOS, 64 px and up: the conch on a deep-blue tile at Apple's icon grid (824 of 1024, centred), with a soft
       shadow below the tile like other Dock icons. -->
  <defs>${grad('#123a66', '#061427')}${glow}${cursorGlow}
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="8"/>
      <feOffset dy="6"/>
      <feComponentTransfer><feFuncA type="linear" slope=".3"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="tile"><rect x="50" y="50" width="412" height="412" rx="92"/></clipPath>
  </defs>
  <rect x="50" y="50" width="412" height="412" rx="92" fill="url(#deep)" filter="url(#shadow)"/>
  <circle cx="256" cy="244" r="180" fill="url(#glow)" clip-path="url(#tile)"/>
  ${shell({}, 'rotate(-6 256 262) translate(256 260) scale(.8) translate(-266 -268)')}
</svg>
`,
  'shellie-mac-small.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- macOS, 16-32 px: the bold small conch on the Apple-grid tile, no glow or shadow. -->
  <defs>${grad('#164475', '#071a31')}${cursorGlow}</defs>
  <rect x="50" y="50" width="412" height="412" rx="92" fill="url(#deep)"/>
  ${shell({ small: true }, 'rotate(-6 256 262) translate(256 260) scale(.86) translate(-266 -268)')}
</svg>
`,
};
for (const [n, v] of Object.entries(out)) writeFileSync(path.join(dir, n), v);
