import { describe, expect, it } from 'vitest';
import { shellQuote } from './shellQuote';

describe('shellQuote', () => {
  it('wraps in single quotes', () => {
    expect(shellQuote('hello world')).toBe("'hello world'");
  });
  it('escapes embedded single quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});
