// The app icon's ship without its tile (assets/icon/shellie-small.svg): a trimaran heading up and right, each hull
// with a lit and a shaded face.
const FACES: [points: string, fill: string][] = [
  ['230,226 230,322 160,390 160,292', '#005ba1'],
  ['282,226 282,322 352,390 352,292', '#003a6c'],
  ['160,160 128,240 136,428 160,428', '#2b88d8'],
  ['160,160 192,240 184,428 160,428', '#0f6cbd'],
  ['352,160 320,240 328,428 352,428', '#0f6cbd'],
  ['352,160 384,240 376,428 352,428', '#004e8c'],
  ['256,16 216,150 224,474 256,474', '#cfe6fb'],
  ['256,16 296,150 288,474 256,474', '#2b88d8'],
];

export function MindMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden="true"
      className="mindmark"
    >
      <g transform="rotate(35 256 256) translate(256 256) scale(1.04) translate(-256 -250)">
        {FACES.map(([points, fill]) => (
          <polygon key={points} points={points} fill={fill} />
        ))}
      </g>
    </svg>
  );
}
