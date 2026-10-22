import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { userDataOverride, worktreeRoot } from './paths';

describe('worktreeRoot', () => {
  it('is a sibling folder named <repo>.worktrees', () => {
    // path.resolve adds the drive letter on Windows.
    const expected = `${path.resolve('/src/webshop')}.worktrees`;
    expect(worktreeRoot('/src/webshop')).toBe(expected);
    expect(worktreeRoot('/src/webshop/')).toBe(expected);
  });
});

describe('userDataOverride', () => {
  it('returns an absolute SHELLIE_USER_DATA', () => {
    const dir = path.resolve('/tmp/shellie-profile');
    expect(userDataOverride({ SHELLIE_USER_DATA: dir })).toBe(dir);
  });

  it('is null when unset, blank or relative', () => {
    expect(userDataOverride({})).toBeNull();
    expect(userDataOverride({ SHELLIE_USER_DATA: '  ' })).toBeNull();
    expect(userDataOverride({ SHELLIE_USER_DATA: 'profile' })).toBeNull();
  });
});
