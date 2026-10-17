import { describe, expect, it } from 'vitest';
import { anchorComment, captureAnchor } from './reviewAnchor';

const file = (lines: string[]) => `${lines.join('\n')}\n`;
const base = file(['a', 'b', 'c', 'target();', 'd', 'e', 'f']);

describe('captureAnchor', () => {
  it('takes the lines and up to 3 lines of context each side', () => {
    expect(captureAnchor(base, 4, 4)).toEqual({
      snippet: 'target();',
      contextBefore: 'a\nb\nc',
      contextAfter: 'd\ne\nf',
      startLine: 4,
      endLine: 4,
    });
  });
  it('clamps a range past the end', () => {
    expect(captureAnchor('x\ny', 2, 9)).toMatchObject({
      snippet: 'y',
      startLine: 2,
      endLine: 2,
    });
  });
});

describe('anchorComment', () => {
  const c = captureAnchor(base, 4, 4);

  it('stays put when nothing changed', () => {
    expect(anchorComment(c, base)).toEqual({ startLine: 4, endLine: 4 });
  });
  it('follows lines inserted above', () => {
    const moved = file(['new1', 'new2', 'a', 'b', 'c', 'target();', 'd']);
    expect(anchorComment(c, moved)).toEqual({ startLine: 6, endLine: 6 });
  });
  it('is gone when the snippet changed', () => {
    const edited = file(['a', 'b', 'c', 'target(1);', 'd', 'e', 'f']);
    expect(anchorComment(c, edited)).toBeNull();
  });
  it('ignores trailing whitespace and CRLF', () => {
    const crlf = base
      .replace(/\n/g, '\r\n')
      .replace('target();', 'target();  ');
    expect(anchorComment(c, crlf)).toEqual({ startLine: 4, endLine: 4 });
  });
  it('picks the copy with matching context among duplicates', () => {
    const dup = file([
      'x',
      'y',
      'z',
      'target();',
      'q',
      'a',
      'b',
      'c',
      'target();',
      'd',
      'e',
      'f',
    ]);
    expect(anchorComment(c, dup)).toEqual({ startLine: 9, endLine: 9 });
  });
  it('picks the nearest copy when context does not decide', () => {
    const plain = {
      startLine: 5,
      snippet: 'x',
      contextBefore: '',
      contextAfter: '',
    };
    expect(anchorComment(plain, file(['x', '1', '2', '3', '4', 'x']))).toEqual({
      startLine: 6,
      endLine: 6,
    });
  });
  it('handles a multi-line snippet', () => {
    const m = captureAnchor(base, 2, 3);
    expect(anchorComment(m, file(['top', ...base.split('\n')]))).toEqual({
      startLine: 3,
      endLine: 4,
    });
  });
});
