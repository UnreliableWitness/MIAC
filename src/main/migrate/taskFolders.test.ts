import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateTaskFolders } from './taskFolders';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'shellie-wt-'));

describe('migrateTaskFolders', () => {
  it('moves .miac to .shellie and excludes it', async () => {
    const wt = tmp();
    mkdirSync(path.join(wt, '.miac'));
    writeFileSync(path.join(wt, '.miac', 'task.md'), '# t');
    const excluded: string[] = [];
    const n = await migrateTaskFolders(
      [{ worktreePath: wt, repoPath: '/repo' }],
      async (r) => {
        excluded.push(r);
      },
    );
    expect(n).toBe(1);
    expect(readFileSync(path.join(wt, '.shellie', 'task.md'), 'utf8')).toBe(
      '# t',
    );
    expect(existsSync(path.join(wt, '.miac'))).toBe(false);
    expect(excluded).toEqual(['/repo']);
  });

  it('leaves a worktree that already has .shellie alone', async () => {
    const wt = tmp();
    mkdirSync(path.join(wt, '.miac'));
    mkdirSync(path.join(wt, '.shellie'));
    const n = await migrateTaskFolders(
      [{ worktreePath: wt, repoPath: '/repo' }],
      async () => {},
    );
    expect(n).toBe(0);
    expect(existsSync(path.join(wt, '.miac'))).toBe(true);
    expect(existsSync(path.join(wt, '.shellie'))).toBe(true);
  });

  it('skips worktrees that are gone', async () => {
    const n = await migrateTaskFolders(
      [{ worktreePath: path.join(tmp(), 'nope'), repoPath: '/repo' }],
      async () => {},
    );
    expect(n).toBe(0);
  });
  it('excludes before the move, so a failed exclude leaves .miac in place', async () => {
    const wt = tmp();
    mkdirSync(path.join(wt, '.miac'));
    const n = await migrateTaskFolders(
      [{ worktreePath: wt, repoPath: '/repo' }],
      async () => {
        expect(existsSync(path.join(wt, '.shellie'))).toBe(false);
        throw new Error('no git');
      },
    );
    expect(n).toBe(0);
    expect(existsSync(path.join(wt, '.miac'))).toBe(true);
    expect(existsSync(path.join(wt, '.shellie'))).toBe(false);
  });
});
