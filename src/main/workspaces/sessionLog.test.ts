import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SessionLogReader,
  writeHitsFromBash,
  writeHitsFromLines,
} from './sessionLog';

const tool = (
  name: string,
  input: unknown,
  cwd = '/w/home',
  type = 'assistant',
) =>
  JSON.stringify({
    type,
    cwd,
    message: { content: [{ type: 'tool_use', name, input }] },
  });

describe('writeHitsFromLines', () => {
  it('counts Edit, Write, MultiEdit and NotebookEdit as edit hits', () => {
    const lines = [
      tool('Edit', { file_path: '/src/b/x.ts' }),
      tool('Write', { file_path: '/src/c/y.ts' }),
      tool('MultiEdit', { file_path: '/src/d/z.ts' }),
      tool('NotebookEdit', { notebook_path: '/src/e/n.ipynb' }),
    ];
    expect(writeHitsFromLines(lines)).toEqual([
      { path: '/src/b/x.ts', via: 'edit' },
      { path: '/src/c/y.ts', via: 'edit' },
      { path: '/src/d/z.ts', via: 'edit' },
      { path: '/src/e/n.ipynb', via: 'edit' },
    ]);
  });

  it('resolves a relative file_path against the line cwd', () => {
    const hits = writeHitsFromLines([
      tool('Edit', { file_path: 'src/x.ts' }, '/w/home'),
    ]);
    expect(hits).toEqual([
      { path: path.resolve('/w/home', 'src/x.ts'), via: 'edit' },
    ]);
  });

  it('ignores read-only tools, non-assistant lines and malformed lines', () => {
    const lines = [
      tool('Read', { file_path: '/src/b/x.ts' }),
      tool('Grep', { pattern: 'a', path: '/src/b' }),
      tool('Glob', { pattern: '*.ts', path: '/src/b' }),
      tool('Edit', { file_path: '/src/b/x.ts' }, '/w', 'user'),
      '{not json',
      '',
      '{"type":"assistant","message":{"content":"text"}}',
      'null',
    ];
    expect(writeHitsFromLines(lines)).toEqual([]);
  });

  it('does not attach a repo that is only read through Bash', () => {
    const lines = [
      tool('Bash', { command: 'git -C /src/b log --oneline' }),
      tool('Bash', { command: 'cd /src/b && git status' }),
      tool('Bash', { command: 'cat /src/b/x' }),
    ];
    expect(writeHitsFromLines(lines)).toEqual([]);
  });

  it('finds Bash writes', () => {
    const lines = [tool('Bash', { command: 'git -C /src/b commit -m x' })];
    expect(writeHitsFromLines(lines)).toEqual([{ path: '/src/b', via: 'git' }]);
  });

  it.runIf(process.platform === 'win32')('resolves Windows paths', () => {
    const hits = writeHitsFromLines([
      tool('Edit', { file_path: 'x.ts' }, 'C:\\src\\a'),
    ]);
    expect(hits).toEqual([{ path: 'C:\\src\\a\\x.ts', via: 'edit' }]);
  });
});

describe('writeHitsFromBash', () => {
  it('finds the worktree path of git worktree add', () => {
    expect(
      writeHitsFromBash(
        'git -C /src/b worktree add /src/b.worktrees/42-x -b feature/42-x origin/main',
        '/w/home',
      ),
    ).toEqual([{ path: '/src/b.worktrees/42-x', via: 'worktree-add' }]);
  });

  it('tracks cd and does not split on a quoted &&', () => {
    expect(
      writeHitsFromBash(
        'cd /src/b.worktrees/42-x && git commit -m "a && b"',
        '/w/home',
      ),
    ).toEqual([{ path: '/src/b.worktrees/42-x', via: 'git' }]);
  });

  it('resolves git -C against cwd', () => {
    expect(writeHitsFromBash('git -C ../b checkout -b x', '/src/a')).toEqual([
      { path: path.resolve('/src/a', '../b'), via: 'git' },
    ]);
  });

  it('lets the last -C win and handles ; || and |', () => {
    expect(
      writeHitsFromBash(
        'git -C /x -C /src/b add . ; ls || echo hi | cat',
        '/w',
      ),
    ).toEqual([{ path: '/src/b', via: 'git' }]);
  });

  it('handles -B, a quoted path, and relative worktree paths', () => {
    expect(
      writeHitsFromBash("git worktree add -B nm '/s/my wt' main", '/w'),
    ).toEqual([{ path: '/s/my wt', via: 'worktree-add' }]);
    expect(
      writeHitsFromBash('cd /s/b && git worktree add ../wt', '/w'),
    ).toEqual([{ path: path.resolve('/s/b', '../wt'), via: 'worktree-add' }]);
  });

  it('ignores read-only git and other commands', () => {
    expect(writeHitsFromBash('git -C /src/b log', '/w')).toEqual([]);
    expect(writeHitsFromBash('cd /src/b && git status', '/w')).toEqual([]);
    expect(writeHitsFromBash('cat /src/b/x', '/w')).toEqual([]);
    expect(writeHitsFromBash('git worktree list', '/w')).toEqual([]);
    expect(writeHitsFromBash('echo "unterminated', '/w')).toEqual([]);
  });

  it('applies cd only to later segments', () => {
    expect(
      writeHitsFromBash('git add . && cd /src/b && git commit -m x', '/w/home'),
    ).toEqual([
      { path: '/w/home', via: 'git' },
      { path: '/src/b', via: 'git' },
    ]);
  });
});

describe('SessionLogReader', () => {
  const fake =
    (files: Record<string, string>) => async (file: string, from: number) => {
      const buf = Buffer.from(files[file] ?? '', 'utf8');
      return { text: buf.subarray(from).toString('utf8'), size: buf.length };
    };

  it('returns all lines first, then only appended ones, holding back a partial line', async () => {
    const files: Record<string, string> = { f: 'a\nb\n' };
    const r = new SessionLogReader(fake(files));
    expect(await r.readNew('f')).toEqual(['a', 'b']);
    expect(await r.readNew('f')).toEqual([]);
    files.f += 'c\npart';
    expect(await r.readNew('f')).toEqual(['c']);
    files.f += 'ial\n';
    expect(await r.readNew('f')).toEqual(['partial']);
  });

  it('restarts at 0 when the file shrinks', async () => {
    const files: Record<string, string> = { f: 'aaa\nbbb\n' };
    const r = new SessionLogReader(fake(files));
    await r.readNew('f');
    files.f = 'x\n';
    expect(await r.readNew('f')).toEqual(['x']);
  });

  it('returns nothing for an unreadable file', async () => {
    const r = new SessionLogReader(async () => null);
    expect(await r.readNew('gone')).toEqual([]);
  });

  it('reads real files incrementally with multibyte text', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sl-'));
    const f = path.join(dir, 's.jsonl');
    await fs.writeFile(f, 'é1\né2\n');
    const r = new SessionLogReader();
    expect(await r.readNew(f)).toEqual(['é1', 'é2']);
    await fs.appendFile(f, 'é3\n');
    expect(await r.readNew(f)).toEqual(['é3']);
    await fs.rm(dir, { recursive: true });
  });
});
