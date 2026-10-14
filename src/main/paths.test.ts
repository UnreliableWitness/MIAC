import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { worktreeRoot } from './paths';

describe('worktreeRoot', () => {
  it('is a sibling folder named <repo>.worktrees', () => {
    // path.resolve adds the drive letter on Windows.
    const expected = `${path.resolve('/src/webshop')}.worktrees`;
    expect(worktreeRoot('/src/webshop')).toBe(expected);
    expect(worktreeRoot('/src/webshop/')).toBe(expected);
  });
});
