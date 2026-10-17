import { describe, expect, it } from 'vitest';
import {
  emptyReviewState,
  globToRegExp,
  isGenerated,
  ReviewScopeSchema,
  ReviewStateSchema,
  viewedKey,
} from './review';

describe('globToRegExp', () => {
  it('matches a bare name in any folder', () => {
    const re = globToRegExp('package-lock.json');
    expect(re.test('package-lock.json')).toBe(true);
    expect(re.test('apps/web/package-lock.json')).toBe(true);
    expect(re.test('package-lock.json.bak')).toBe(false);
  });
  it('anchors a pattern with a slash at the root', () => {
    const re = globToRegExp('dist/**');
    expect(re.test('dist/a.js')).toBe(true);
    expect(re.test('dist/x/y/a.js')).toBe(true);
    expect(re.test('src/dist/a.js')).toBe(false);
  });
  it('keeps * inside one folder and **/ across folders', () => {
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/x/a.ts')).toBe(false);
    expect(globToRegExp('src/**/gen.ts').test('src/gen.ts')).toBe(true);
    expect(globToRegExp('src/**/gen.ts').test('src/a/b/gen.ts')).toBe(true);
  });
  it('escapes regex characters', () => {
    expect(globToRegExp('a+b.(c).js').test('a+b.(c).js')).toBe(true);
    expect(globToRegExp('a+b.(c).js').test('aab.(c).js')).toBe(false);
  });
});

describe('isGenerated', () => {
  it('collapses lock files, minified files, maps and dist by default', () => {
    for (const p of [
      'package-lock.json',
      'web/yarn.lock',
      'pnpm-lock.yaml',
      'vendor/x.min.js',
      'out/app.js.map',
      'dist/index.js',
    ])
      expect(isGenerated(p)).toBe(true);
    expect(isGenerated('src/index.ts')).toBe(false);
  });
  it('adds the repo patterns', () => {
    expect(isGenerated('src/api/generated.ts', ['src/api/*.ts'])).toBe(true);
  });
});

describe('schemas', () => {
  it('accepts the three scopes and refuses a bad commit ref', () => {
    expect(ReviewScopeSchema.parse({ kind: 'all' })).toEqual({ kind: 'all' });
    expect(
      ReviewScopeSchema.safeParse({
        kind: 'commits',
        workspaceId: 'home',
        from: 'abc1234',
        to: 'abc1234',
      }).success,
    ).toBe(true);
    expect(
      ReviewScopeSchema.safeParse({
        kind: 'commits',
        workspaceId: 'home',
        from: 'HEAD; rm -rf /',
        to: 'abc1234',
      }).success,
    ).toBe(false);
  });
  it('fills defaults for an old or empty state', () => {
    expect(ReviewStateSchema.parse({ version: 1 })).toEqual(emptyReviewState());
  });
  it('keys viewed files by workspace and path', () => {
    expect(viewedKey('home', 'src/a.ts')).toBe('home:src/a.ts');
  });
});
