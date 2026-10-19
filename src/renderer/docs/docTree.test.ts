import { describe, expect, it } from 'vitest';
import type { SessionDoc } from '../../shared/types';
import { buildDocTree, parentDir, type TreeNode } from './docTree';

const doc = (
  path: string,
  workspaceId: string | null = 'home',
): SessionDoc => ({
  path,
  workspaceId,
  changed: null,
  claude: true,
  mtimeMs: 1,
});

/** Folders as "name/" with their children indented, files by name. */
const show = (nodes: TreeNode[], depth = 0): string[] =>
  nodes.flatMap((n) =>
    n.kind === 'file'
      ? [`${'  '.repeat(depth)}${n.name}`]
      : [
          `${'  '.repeat(depth)}${n.name.replace(/\/$/, '')}/`,
          ...show(n.children, depth + 1),
        ],
  );

describe('buildDocTree', () => {
  it('puts workspace files under the repo name, in order, folders first, alphabetical', () => {
    const tree = buildDocTree(
      [
        doc('z.md'),
        doc('docs/b.md'),
        doc('docs/a.md'),
        doc('notes.md', 'w2'),
        doc('A.md'),
      ],
      ['home', 'w2'],
      (id) => (id === 'home' ? 'webshop' : 'api'),
    );
    expect(show(tree)).toEqual([
      'webshop/',
      '  docs/',
      '    a.md',
      '    b.md',
      '  A.md',
      '  z.md',
      'api/',
      '  notes.md',
    ]);
  });

  it('puts outside files under their absolute folder, after the workspaces, including Windows paths', () => {
    const tree = buildDocTree(
      [
        doc('C:/Projects/investigations/2026-10-19-push-order.md', null),
        doc('/Users/me/notes/a.md', null),
        doc('README.md'),
        doc('C:/root.md', null),
      ],
      ['home'],
      () => 'webshop',
    );
    expect(show(tree)).toEqual([
      'webshop/',
      '  README.md',
      '/Users/me/notes/',
      '  a.md',
      'C:/',
      '  root.md',
      'C:/Projects/investigations/',
      '  2026-10-19-push-order.md',
    ]);
    expect(tree.every((r) => r.root)).toBe(true);
  });

  it('compacts a chain of single folders but never a root', () => {
    const tree = buildDocTree(
      [doc('docs/superpowers/specs/a.md'), doc('docs/superpowers/specs/b.md')],
      ['home'],
      () => 'repo',
    );
    expect(show(tree)).toEqual([
      'repo/',
      '  docs/superpowers/specs/',
      '    a.md',
      '    b.md',
    ]);
  });
});

describe('parentDir', () => {
  it.each([
    ['C:/x/a.md', 'C:/x'],
    ['C:/a.md', 'C:/'],
    ['/a.md', '/'],
    ['/u/a.md', '/u'],
  ])('%s -> %s', (p, d) => expect(parentDir(p)).toBe(d));
});
