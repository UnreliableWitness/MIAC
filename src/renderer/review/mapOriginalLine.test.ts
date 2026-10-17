import { describe, expect, it } from 'vitest';
import { type LineChange, mapOriginalLine } from './mapOriginalLine';

const change = (
  os: number,
  oe: number,
  ms: number,
  me: number,
): LineChange => ({
  originalStartLineNumber: os,
  originalEndLineNumber: oe,
  modifiedStartLineNumber: ms,
  modifiedEndLineNumber: me,
});

describe('mapOriginalLine', () => {
  it('keeps the line when nothing changed', () => {
    expect(mapOriginalLine(7, [])).toBe(7);
    expect(mapOriginalLine(0, [])).toBe(0);
  });

  it('shifts lines below an insertion', () => {
    // Two lines inserted after original line 3 (modified 4-5).
    const c = [change(3, 0, 4, 5)];
    expect(mapOriginalLine(3, c)).toBe(3);
    expect(mapOriginalLine(4, c)).toBe(6);
  });

  it('maps a deleted line to the line before the gap and shifts lines below up', () => {
    // Original lines 4-6 deleted; Monaco reports modifiedStart 3 (the line before), end 0.
    const c = [change(4, 6, 3, 0)];
    expect(mapOriginalLine(3, c)).toBe(3);
    expect(mapOriginalLine(5, c)).toBe(3);
    expect(mapOriginalLine(7, c)).toBe(4);
  });

  it('maps a deletion at the top to 0', () => {
    expect(mapOriginalLine(1, [change(1, 2, 0, 0)])).toBe(0);
  });

  it('maps a line inside a replacement to its last modified line', () => {
    // Original 10-11 replaced by modified 10-13.
    const c = [change(10, 11, 10, 13)];
    expect(mapOriginalLine(10, c)).toBe(13);
    expect(mapOriginalLine(11, c)).toBe(13);
    expect(mapOriginalLine(12, c)).toBe(14);
    expect(mapOriginalLine(9, c)).toBe(9);
  });

  it('adds up the shifts of every change above', () => {
    const c = [change(2, 0, 3, 4), change(5, 6, 7, 0), change(10, 10, 10, 12)];
    // +2, then -2, then +2 for a line below all three.
    expect(mapOriginalLine(20, c)).toBe(22);
    // Between the first and second change.
    expect(mapOriginalLine(4, c)).toBe(6);
    // Inside the second (deleted) change.
    expect(mapOriginalLine(6, c)).toBe(7);
  });
});
