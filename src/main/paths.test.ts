import { describe, expect, it } from 'vitest';
import { worktreeRoot } from './paths';

describe('worktreeRoot', () => {
  it('is a sibling folder named <repo>.worktrees', () => {
    expect(worktreeRoot('/src/webshop')).toBe('/src/webshop.worktrees');
    expect(worktreeRoot('/src/webshop/')).toBe('/src/webshop.worktrees');
  });
});
