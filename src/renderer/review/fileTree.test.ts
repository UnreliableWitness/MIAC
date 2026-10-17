import { describe, expect, it } from 'vitest';
import type { ReviewFile } from '../../shared/review';
import { buildTree, holds, treeFiles, type TreeDir } from './fileTree';

const f = (path: string): ReviewFile => ({
  path,
  status: 'M',
  added: 1,
  removed: 0,
  binary: false,
  hash: path,
});
// The tree as folder names and file paths, for comparing whole shapes.
const shape = (d: TreeDir): unknown => ({
  name: d.name,
  dirs: d.dirs.map(shape),
  files: d.files.map((x) => x.path),
});

describe('buildTree', () => {
  it('nests files under their folders, folders first, both by name', () => {
    const t = buildTree([
      f('z.md'),
      f('src/b.ts'),
      f('src/a.ts'),
      f('docs/x.md'),
      f('a.md'),
    ]);
    expect(shape(t)).toEqual({
      name: '',
      dirs: [
        { name: 'docs', dirs: [], files: ['docs/x.md'] },
        { name: 'src', dirs: [], files: ['src/a.ts', 'src/b.ts'] },
      ],
      files: ['a.md', 'z.md'],
    });
  });

  it('compacts a chain of single folders into one row', () => {
    const t = buildTree([
      f('src/renderer/review/a.ts'),
      f('src/renderer/review/b.ts'),
      f('src/main/c.ts'),
    ]);
    expect(shape(t)).toEqual({
      name: '',
      dirs: [
        {
          name: 'src',
          dirs: [
            { name: 'main', dirs: [], files: ['src/main/c.ts'] },
            {
              name: 'renderer/review',
              dirs: [],
              files: ['src/renderer/review/a.ts', 'src/renderer/review/b.ts'],
            },
          ],
          files: [],
        },
      ],
      files: [],
    });
    // The compacted row carries the deepest folder's path, the key a collapse is kept under.
    expect(t.dirs[0].dirs[1].path).toBe('src/renderer/review');
  });

  it('stops compacting at a folder that holds files', () => {
    const t = buildTree([f('a/x.ts'), f('a/b/y.ts')]);
    expect(t.dirs.map((d) => d.name)).toEqual(['a']);
    expect(t.dirs[0].dirs.map((d) => d.name)).toEqual(['b']);
  });

  it('keeps root files at the root', () => {
    expect(shape(buildTree([f('README.md')]))).toEqual({
      name: '',
      dirs: [],
      files: ['README.md'],
    });
  });
});

describe('treeFiles', () => {
  it('lists files in the order the tree shows them', () => {
    const t = buildTree([f('b.ts'), f('src/z.ts'), f('a.ts'), f('lib/q/r.ts')]);
    expect(treeFiles(t).map((x) => x.path)).toEqual([
      'lib/q/r.ts',
      'src/z.ts',
      'a.ts',
      'b.ts',
    ]);
  });
});

describe('holds', () => {
  it('matches files at any depth, not folders sharing a prefix', () => {
    expect(holds('src', 'src/a/b.ts')).toBe(true);
    expect(holds('src', 'srcx/a.ts')).toBe(false);
    expect(holds('', 'a.ts')).toBe(true);
  });
});
