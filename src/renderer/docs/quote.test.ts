import { describe, expect, it } from 'vitest';
import { buildQuote, MAX_QUOTE } from './quote';

describe('buildQuote', () => {
  it('quotes one line', () => {
    expect(buildQuote('docs/a.md', 4, 4, 'hello')).toBe(
      'docs/a.md:4\n> hello\n\n',
    );
  });
  it('quotes a range, keeps empty lines as ">", normalises CRLF', () => {
    expect(buildQuote('a.md', 2, 4, 'x\r\n\r\ny\r\n')).toBe(
      'a.md:2-4\n> x\n>\n> y\n\n',
    );
  });
  it('truncates at 4000 characters', () => {
    const q = buildQuote('a.md', 1, 900, 'y'.repeat(5000));
    expect(q.endsWith('\n> …(truncated)\n\n')).toBe(true);
    expect(q.length).toBeLessThan(MAX_QUOTE + 60);
  });
  it('builds one line without newlines for terminals without bracketed paste', () => {
    expect(buildQuote('a.md', 1, 2, 'x\ny', { singleLine: true })).toBe(
      'a.md:1-2 "x y" ',
    );
  });
});

describe('buildQuote control characters', () => {
  const hostile = 'x\x1b[201~\r\rrm -rf\x03\x04';
  it('drops ESC, CR and Ctrl-C from a multi-line quote', () => {
    const q = buildQuote('a.md', 1, 1, hostile);
    expect(q.includes('\x1b')).toBe(false);
    expect(q.includes('\r')).toBe(false);
    expect(q.includes('\x03')).toBe(false);
    expect(q.includes('\x04')).toBe(false);
  });
  it('drops ESC, CR and Ctrl-C from a single-line quote', () => {
    const q = buildQuote('a.md', 1, 1, hostile, { singleLine: true });
    expect(q.includes('\x1b')).toBe(false);
    expect(q.includes('\r')).toBe(false);
    expect(q.includes('\x03')).toBe(false);
    expect(q.includes('\x04')).toBe(false);
  });
  it('keeps tabs and newlines in multi-line quotes', () => {
    expect(buildQuote('a.md', 1, 2, 'a\tb\nc')).toBe(
      'a.md:1-2\n> a\tb\n> c\n\n',
    );
  });
});
