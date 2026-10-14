import { describe, expect, it } from 'vitest';
import { buildIco } from './ico.mjs';

describe('buildIco', () => {
  it('writes the ICONDIR header and one 16-byte entry per image, then the PNG data', () => {
    const a = Buffer.from([1, 2, 3]);
    const b = Buffer.from([4, 5, 6, 7]);
    const ico = buildIco([
      { size: 16, png: a },
      { size: 256, png: b },
    ]);
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    // entry 0
    expect(ico[6]).toBe(16);
    expect(ico[7]).toBe(16);
    expect(ico.readUInt16LE(6 + 4)).toBe(1); // planes
    expect(ico.readUInt16LE(6 + 6)).toBe(32); // bpp
    expect(ico.readUInt32LE(6 + 8)).toBe(3); // size
    expect(ico.readUInt32LE(6 + 12)).toBe(6 + 2 * 16);
    // entry 1: 256 is stored as 0
    expect(ico[22]).toBe(0);
    expect(ico[23]).toBe(0);
    expect(ico.readUInt32LE(22 + 12)).toBe(6 + 2 * 16 + 3);
    expect([...ico.subarray(38)]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('rejects sizes above 256', () => {
    expect(() => buildIco([{ size: 512, png: Buffer.from([0]) }])).toThrow(
      /256/,
    );
  });
});
