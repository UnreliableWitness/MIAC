import { describe, expect, it } from 'vitest';
import { findLinks, resolveRelative } from './linkify';

const paths = (s: string) =>
  findLinks(s).map((l) =>
    l.kind === 'path' ? [l.path, l.line, l.col] : ['url', l.url],
  );

describe('findLinks', () => {
  it('finds Claude Code style paths with lines', () => {
    expect(paths('Updated src/main/x.ts:12:5 and docs/plan.md:40')).toEqual([
      ['src/main/x.ts', 12, 5],
      ['docs/plan.md', 40, undefined],
    ]);
  });
  it('finds tsc (line,col) and ./ paths', () => {
    expect(paths('src/a.ts(3,7): error TS2322')).toEqual([['src/a.ts', 3, 7]]);
    expect(paths('see ./docs/plan.md')).toEqual([
      ['./docs/plan.md', undefined, undefined],
    ]);
  });
  it('finds Windows drive paths', () => {
    expect(paths('at C:\\work\\repo\\src\\a.ts:3')).toEqual([
      ['C:\\work\\repo\\src\\a.ts', 3, undefined],
    ]);
  });
  it('finds vitest stack paths in parentheses', () => {
    expect(paths(' ❯ src/x.test.ts:10:3')).toEqual([['src/x.test.ts', 10, 3]]);
  });
  it('finds URLs and trims trailing punctuation unless brackets balance', () => {
    expect(paths('open http://localhost:5173/.')).toEqual([
      ['url', 'http://localhost:5173/'],
    ]);
    expect(paths('(see https://x.dev/a)')).toEqual([
      ['url', 'https://x.dev/a'],
    ]);
    expect(paths('https://en.wikipedia.org/wiki/A_(b)')).toEqual([
      ['url', 'https://en.wikipedia.org/wiki/A_(b)'],
    ]);
  });
  it('does not link plain words with dots or paths inside URLs', () => {
    expect(paths('e.g. v1.0.1 is done.')).toEqual([]);
    expect(paths('https://x.dev/docs/a.md')).toEqual([
      ['url', 'https://x.dev/docs/a.md'],
    ]);
  });
  it('links bare file names with a known extension', () => {
    expect(paths('edit README.md now')).toEqual([
      ['README.md', undefined, undefined],
    ]);
  });
  it('reports string offsets', () => {
    const [l] = findLinks('ab docs/a.md:3 cd');
    expect([l.start, l.end, l.text]).toEqual([3, 14, 'docs/a.md:3']);
  });
});

describe('resolveRelative', () => {
  it('resolves against the document folder', () => {
    expect(resolveRelative('docs/specs/a.md', '../plans/b.md')).toBe(
      'docs/plans/b.md',
    );
    expect(resolveRelative('docs/a.md', './img/x.png')).toBe('docs/img/x.png');
    expect(resolveRelative('README.md', 'docs/a.md#part')).toBe('docs/a.md');
    expect(resolveRelative('docs/a.md', '/README.md')).toBe('README.md');
  });
  it('returns null when it climbs out of the worktree', () => {
    expect(resolveRelative('a.md', '../../x.md')).toBeNull();
  });
  it('decodes percent-encoding', () => {
    expect(resolveRelative('a.md', 'my%20notes.md')).toBe('my notes.md');
  });
  it('keeps a document outside the worktree absolute, under its root', () => {
    expect(resolveRelative('/x/inv/a.md', 'img/p.png')).toBe(
      '/x/inv/img/p.png',
    );
    expect(resolveRelative('C:/Projects/inv/a.md', './p.png')).toBe(
      'C:/Projects/inv/p.png',
    );
    expect(resolveRelative('C:/Projects/inv/a.md', '../b.md')).toBe(
      'C:/Projects/b.md',
    );
    expect(resolveRelative('C:/a.md', '../b.md')).toBeNull();
    expect(resolveRelative('/a.md', '../b.md')).toBeNull();
  });
});

describe('findLinks on Claude Code tool lines', () => {
  it('finds a Windows path inside Update(...) and Write(...)', () => {
    expect(
      paths(
        '● Update(C:\\Projects\\investigations\\2026-10-19-ado-7951-push-order-to-fo.md)',
      ),
    ).toEqual([
      [
        'C:\\Projects\\investigations\\2026-10-19-ado-7951-push-order-to-fo.md',
        undefined,
        undefined,
      ],
    ]);
    expect(paths('● Write(/Users/me/notes/plan.md)')).toEqual([
      ['/Users/me/notes/plan.md', undefined, undefined],
    ]);
  });
});
