import { describe, expect, it } from 'vitest';
import { clampMessage, MESSAGE_MAX } from './attention';

describe('clampMessage', () => {
  it('turns newlines and tabs into single spaces', () => {
    expect(clampMessage('a\n\tb\r\nc')).toBe('a b c');
  });

  it('removes control and bidi format characters', () => {
    expect(clampMessage('a\u001b[31mb\u202Ec')).toBe('a[31mbc');
  });

  it('never splits a surrogate pair at the limit', () => {
    const out = clampMessage('a'.repeat(MESSAGE_MAX - 2) + '😀😀😀');
    expect(Array.from(out)).toHaveLength(MESSAGE_MAX);
    expect(out.endsWith('😀…')).toBe(true);
    expect(out).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });

  it('keeps short text unchanged', () => {
    expect(clampMessage('  hi  ')).toBe('hi');
  });
});
