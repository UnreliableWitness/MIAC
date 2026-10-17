import { describe, expect, it } from 'vitest';
import { type ReviewRepo, viewedKey } from '../../shared/review';
import { isFolded, repoSignature, viewedIn } from './repoGroups';

const repo = (hashes: Record<string, string>): ReviewRepo => ({
  workspaceId: 'w2',
  name: 'api',
  base: 'b'.repeat(40),
  commits: [],
  uncommitted: 0,
  collapse: [],
  files: Object.entries(hashes).map(([path, hash]) => ({
    path,
    status: 'M',
    added: 1,
    removed: 0,
    binary: false,
    hash,
  })),
});
const seen = (r: ReviewRepo) =>
  Object.fromEntries(r.files.map((f) => [viewedKey('w2', f.path), f.hash]));

describe('repo groups', () => {
  it('counts the files viewed at their current content', () => {
    const r = repo({ 'a.ts': 'h1', 'b.ts': 'h2' });
    expect(viewedIn(r, { [viewedKey('w2', 'a.ts')]: 'h1' })).toBe(1);
    expect(viewedIn(r, { [viewedKey('w2', 'a.ts')]: 'old' })).toBe(0);
  });

  it('folds by itself once every file is viewed, and opens when one changes', () => {
    const r = repo({ 'a.ts': 'h1', 'b.ts': 'h2' });
    expect(isFolded(r, {}, undefined)).toBe(false);
    const viewed = seen(r);
    expect(isFolded(r, viewed, undefined)).toBe(true);
    expect(
      isFolded(repo({ 'a.ts': 'h1', 'b.ts': 'h3' }), viewed, undefined),
    ).toBe(false);
  });

  it('never folds a repo without files', () => {
    expect(isFolded(repo({}), {}, undefined)).toBe(false);
  });

  it('keeps a fold made by hand until a file changes', () => {
    const r = repo({ 'a.ts': 'h1' });
    const closed = { how: 'closed' as const, at: repoSignature(r) };
    expect(isFolded(r, {}, closed)).toBe(true);
    const open = { how: 'open' as const, at: repoSignature(r) };
    expect(isFolded(r, seen(r), open)).toBe(false);
    // a.ts changed: back to automatic, and not every file is viewed.
    expect(isFolded(repo({ 'a.ts': 'h2' }), seen(r), closed)).toBe(false);
  });
});
