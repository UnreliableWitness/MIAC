// The app icon's conch without its tile (assets/icon/shellie-small.svg): two whorls over a body whorl, each with a
// lit and a shaded face, and a cursor in the dark opening.
const FACES: [points: string, fill: string][] = [
  ['256,70 204,123.95 248.2,153 248.2,123.95', '#cfe6fb'],
  ['256,70 248.2,123.95 308,123.95', '#7fb8ec'],
  ['204,123.95 248.2,123.95 248.2,153 207.12,153', '#a9d2f5'],
  ['248.2,123.95 308,123.95 304.88,153 248.2,153', '#2b88d8'],
  ['210,167 237,167 241,216.4 156,216.4', '#cfe6fb'],
  ['237,167 302,167 356,216.4 241,216.4', '#7fb8ec'],
  ['156,216.4 241,216.4 241,243 162,243', '#a9d2f5'],
  ['241,216.4 356,216.4 350,243 241,243', '#2b88d8'],
  ['152,257 240,257 216,336 184,408 136,322', '#cfe6fb'],
  ['240,257 354,257 374,296 286,312 242,406 184,408 216,336', '#7fb8ec'],
  ['184,408 242,406 262,466', '#7fb8ec'],
  ['286,312 374,296 392,370 372,432 318,468 262,466 242,406', '#2b88d8'],
  ['292,326 362,316 374,372 356,424 314,452 284,432 276,380', '#071a31'],
  ['242,406 278,380 286,432 262,466', '#cfe6fb'],
];

export function MindMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="56 66 400 400"
      aria-hidden="true"
      className="mindmark"
    >
      <g transform="rotate(-6 256 262)">
        {FACES.map(([points, fill]) => (
          <polygon key={points} points={points} fill={fill} />
        ))}
        <rect x="309" y="352" width="26" height="64" rx="9" fill="#ffffff" />
      </g>
    </svg>
  );
}
