import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewFile, ReviewRepo } from '../../../shared/review';
import { viewedKey } from '../../../shared/review';
import { dirKey } from '../../review/fileTree';
import { FileTree } from './FileTree';

const f = (path: string): ReviewFile => ({
  path,
  status: 'M',
  added: 1,
  removed: 0,
  binary: false,
  hash: `h-${path}`,
});
const repo = (files: ReviewFile[]): ReviewRepo =>
  ({
    workspaceId: 'home',
    name: 'web',
    base: 'b'.repeat(40),
    commits: [],
    files,
  }) as unknown as ReviewRepo;

function show(over: Partial<Parameters<typeof FileTree>[0]> = {}): {
  onToggleDir: ReturnType<typeof vi.fn>;
} {
  const onToggleDir = vi.fn();
  render(
    <FileTree
      repos={[
        repo([
          f('README.md'),
          f('src/renderer/review/a.ts'),
          f('src/renderer/review/b.ts'),
          f('src/main/c.ts'),
        ]),
      ]}
      view="tree"
      selected={null}
      viewed={{}}
      collapsed={[]}
      commentCount={() => 0}
      onSelect={() => {}}
      onViewed={() => {}}
      onToggleDir={onToggleDir}
      {...over}
    />,
  );
  return { onToggleDir };
}
const rows = () =>
  screen
    .getAllByRole('treeitem')
    .map((r) => r.querySelector('.review-name')?.firstChild?.textContent);

describe('FileTree', () => {
  it('shows folders before files, single-folder chains as one row', () => {
    show();
    expect(rows()).toEqual([
      'src',
      'main',
      'c.ts',
      'renderer/review',
      'a.ts',
      'b.ts',
      'README.md',
    ]);
    // In the tree the folder is the row above, so the name stands alone.
    expect(screen.queryByText('src/main/')).toBeNull();
  });

  it('indents each level', () => {
    show();
    const pad = (name: string) =>
      (screen.getByText(name).closest('[role="treeitem"]') as HTMLElement).style
        .paddingLeft;
    expect(pad('src')).toBe('12px');
    expect(pad('main')).toBe('26px');
    expect(pad('c.ts')).toBe('40px');
    expect(pad('README.md')).toBe('12px');
  });

  it('hides a folded folder’s files and folds on a click', () => {
    const { onToggleDir } = show({
      collapsed: [dirKey('home', 'src/renderer/review')],
    });
    expect(screen.queryByText('a.ts')).toBeNull();
    expect(screen.getByText('c.ts')).toBeTruthy();
    const folded = screen
      .getByText('renderer/review')
      .closest('[role="treeitem"]');
    expect(folded?.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByText('main'));
    expect(onToggleDir).toHaveBeenCalledWith(dirKey('home', 'src/main'));
  });

  it('counts viewed files and open comments under a folder', () => {
    show({
      viewed: {
        [viewedKey('home', 'src/renderer/review/a.ts')]:
          'h-src/renderer/review/a.ts',
        // An old hash: changed since viewed, so not counted.
        [viewedKey('home', 'src/main/c.ts')]: 'stale',
      },
      commentCount: (ref) => (ref.path.endsWith('b.ts') ? 2 : 0),
    });
    expect(screen.getByLabelText('1 of 3 viewed')).toBeTruthy();
    expect(screen.getByLabelText('1 of 2 viewed')).toBeTruthy();
    expect(screen.getByLabelText('2 comments in src')).toBeTruthy();
    expect(
      screen.getByLabelText('2 comments in src/renderer/review'),
    ).toBeTruthy();
  });

  it('shows the flat list with each file’s folder in list view', () => {
    show({ view: 'list' });
    const tree = screen.getByRole('tree');
    expect(within(tree).queryAllByRole('treeitem', { expanded: true })).toEqual(
      [],
    );
    expect(rows()).toEqual(['README.md', 'a.ts', 'b.ts', 'c.ts']);
    expect(screen.getByText('src/main/', { exact: false })).toBeTruthy();
  });

  it('builds a tree for the generated files when they are shown', () => {
    render(
      <FileTree
        repos={[
          {
            ...repo([f('src/a.ts'), f('dist/x/out.js')]),
          },
        ]}
        view="tree"
        selected={null}
        viewed={{}}
        collapsed={[]}
        commentCount={() => 0}
        onSelect={() => {}}
        onViewed={() => {}}
        onToggleDir={() => {}}
      />,
    );
    expect(screen.queryByText('out.js')).toBeNull();
    fireEvent.click(screen.getByText('Generated (1)'));
    expect(screen.getByText('dist/x')).toBeTruthy();
    expect(screen.getByText('out.js')).toBeTruthy();
  });
});
