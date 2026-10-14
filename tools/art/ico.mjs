// Packs PNG images into a Windows .ico (PNG-compressed entries, supported since Windows Vista).
/** @param {{ size: number, png: Buffer }[]} entries */
export function buildIco(entries) {
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, png }, i) => {
    if (size < 1 || size > 256)
      throw new Error(`ICO sizes must be 1-256, got ${size}`);
    const at = 6 + i * 16;
    header[at] = size === 256 ? 0 : size;
    header[at + 1] = size === 256 ? 0 : size;
    header[at + 2] = 0;
    header[at + 3] = 0;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.png)]);
}
