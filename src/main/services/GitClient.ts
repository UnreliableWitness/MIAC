import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitSummary, TaskSummary } from '../../shared/types';
import { realWait, withRetry, type Wait } from '../fsRetry';
import { nativePath } from '../paths';

const execFileAsync = promisify(execFile);

export class GitError extends Error {
  constructor(
    public readonly args: string[],
    public readonly stderr: string,
    public readonly code: number | null,
    cause?: unknown,
  ) {
    super(
      `git ${args.join(' ')} failed${code === null ? '' : ` (${code})`}: ${stderr.trim()}`,
      { cause },
    );
    this.name = 'GitError';
  }
}

/** How Windows reports a folder that a process (a shell, a dev server, an indexer) still holds open. */
const FOLDER_IN_USE =
  /Permission denied|Directory not empty|being used by another process|EBUSY/i;

/**
 * Backoff for removing a worktree, about 5 s in total: with conpty.dll a killed terminal's pipe closes
 * before a child that handles CTRL_CLOSE (a dev server) has let go of the folder.
 */
const REMOVE_WAITS = [50, 100, 200, 400, 800, 1600, 1850];

/** A Done page lists at most this many commits; `commitCount` has the full number. */
const MAX_SUMMARY_COMMITS = 50;

/** Thin wrapper over the git CLI. Every method takes the directory to run in. */
export class GitClient {
  constructor(private readonly wait: Wait = realWait) {}

  async run(cwd: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      });
      return stdout;
    } catch (e) {
      const err = e as {
        stderr?: string;
        code?: number | string;
        message: string;
      };
      const code = typeof err.code === 'number' ? err.code : null;
      const stderr = (err.stderr ?? '').trim() || err.message;
      throw new GitError(args, stderr, code, e);
    }
  }

  async toplevel(dir: string): Promise<string | null> {
    try {
      const out = (
        await this.run(dir, ['rev-parse', '--show-toplevel'])
      ).trim();
      return out ? nativePath(out) : null;
    } catch {
      return null;
    }
  }

  /** The shared .git directory, also from inside a linked worktree. */
  async commonDir(cwd: string): Promise<string> {
    const out = (await this.run(cwd, ['rev-parse', '--git-common-dir'])).trim();
    return nativePath(path.resolve(cwd, out));
  }

  async branchExists(cwd: string, branch: string): Promise<boolean> {
    try {
      await this.run(cwd, [
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/heads/${branch}`,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async validBranchName(cwd: string, branch: string): Promise<boolean> {
    if (branch.length === 0 || branch.startsWith('-')) return false;
    try {
      await this.run(cwd, ['check-ref-format', `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  async remotes(cwd: string): Promise<string[]> {
    return (await this.run(cwd, ['remote']))
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** `origin/main` fetches `main` from `origin`. A ref without a known remote prefix is left alone. Returns whether it fetched. */
  async fetch(cwd: string, baseRef: string): Promise<boolean> {
    const slash = baseRef.indexOf('/');
    if (slash <= 0) return false;
    const remote = baseRef.slice(0, slash);
    const branch = baseRef.slice(slash + 1);
    if (!(await this.remotes(cwd)).includes(remote)) return false;
    await this.run(cwd, ['fetch', '--quiet', remote, branch]);
    return true;
  }

  async worktreeAdd(
    cwd: string,
    o: { branch: string; path: string; baseRef: string },
  ): Promise<void> {
    await this.run(cwd, [
      '-c',
      'core.longpaths=true',
      'worktree',
      'add',
      // Without this, a branch made from origin/main tracks origin/main and looks "not pushed" forever.
      '--no-track',
      '-b',
      o.branch,
      o.path,
      o.baseRef,
    ]);
  }

  async worktreeRemove(
    cwd: string,
    worktreePath: string,
    force: boolean,
  ): Promise<void> {
    // Just-killed terminals can hold the folder for a moment on Windows; retry those failures only.
    await withRetry(
      () =>
        this.run(cwd, [
          '-c',
          'core.longpaths=true',
          'worktree',
          'remove',
          ...(force ? ['--force'] : []),
          worktreePath,
        ]),
      (e) => e instanceof GitError && FOLDER_IN_USE.test(e.stderr),
      this.wait,
      REMOVE_WAITS,
    );
  }

  async worktreePrune(cwd: string): Promise<void> {
    await this.run(cwd, ['-c', 'core.longpaths=true', 'worktree', 'prune']);
  }

  async deleteBranch(cwd: string, branch: string): Promise<void> {
    await this.run(cwd, ['branch', '-D', branch]);
  }

  async summary(worktree: string, baseRef: string): Promise<GitSummary> {
    const out = await this.run(worktree, [
      '--no-optional-locks',
      'status',
      '--porcelain=v1',
      '--branch',
    ]);
    const lines = out.split('\n');
    const head = lines.shift() ?? '';
    const m = /^## (\S+?)(?:\.\.\.(\S+))?(?: \[([^\]]+)\])?$/.exec(head);
    let branch = m?.[1] ?? '';
    if (!m || branch === 'HEAD') {
      const current = (
        await this.run(worktree, ['branch', '--show-current'])
      ).trim();
      branch = current || 'HEAD';
    }
    const upstream = m?.[2];
    const track = m?.[3] ?? '';
    const num = (re: RegExp) => Number(re.exec(track)?.[1] ?? 0);
    let ahead = 0;
    let behind = 0;
    if (upstream) {
      ahead = num(/ahead (\d+)/);
      behind = num(/behind (\d+)/);
    } else {
      try {
        ahead =
          Number(
            (
              await this.run(worktree, [
                'rev-list',
                '--count',
                `${baseRef}..HEAD`,
              ])
            ).trim(),
          ) || 0;
      } catch {
        ahead = 0;
      }
    }
    const files = lines
      .filter((l) => l.length > 3)
      .map((l) => ({
        status: (l.slice(0, 2).trim()[0] ?? '?') as string,
        path: l.slice(3),
      }));
    return { branch, ahead, behind, hasUpstream: Boolean(upstream), files };
  }

  /**
   * What the task's branch did since it left `baseRef`: its commits (oldest first, at most 50), the diff stat,
   * and whether it is pushed. Falls back to the whole history when there is no merge base.
   */
  async finishSummary(
    worktree: string,
    baseRef: string,
    branch: string,
  ): Promise<TaskSummary> {
    let base: string | null = null;
    try {
      base = (await this.run(worktree, ['merge-base', baseRef, 'HEAD'])).trim();
    } catch {
      base = null;
    }
    const range = base ? `${base}..HEAD` : 'HEAD';
    const log = await this.run(worktree, [
      'log',
      '--reverse',
      '--format=%h%x09%s',
      range,
    ]);
    const lines = log.split('\n').filter(Boolean);
    const commits = lines.slice(0, MAX_SUMMARY_COMMITS).map((l) => {
      const tab = l.indexOf('\t');
      return tab < 0
        ? { sha: l, subject: '' }
        : { sha: l.slice(0, tab), subject: l.slice(tab + 1) };
    });
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;
    if (base) {
      const stat = await this.run(worktree, [
        'diff',
        '--shortstat',
        `${base}..HEAD`,
      ]);
      const num = (re: RegExp) => Number(re.exec(stat)?.[1] ?? 0);
      filesChanged = num(/(\d+) files? changed/);
      insertions = num(/(\d+) insertions?\(\+\)/);
      deletions = num(/(\d+) deletions?\(-\)/);
    }
    const { upstream, pushed } = await this.pushState(
      worktree,
      baseRef,
      branch,
    );
    return {
      commits,
      commitCount: lines.length,
      filesChanged,
      insertions,
      deletions,
      pushed,
      upstream,
    };
  }

  /**
   * Whether `branch` is on its remote: `<remote>/<branch>` exists and contains HEAD. The remote is the base's
   * remote, else `origin`. The configured upstream is ignored, since `git push origin <branch>` does not set it.
   */
  private async pushState(
    worktree: string,
    baseRef: string,
    branch: string,
  ): Promise<{ upstream: string | null; pushed: boolean }> {
    let remotes: string[];
    try {
      remotes = await this.remotes(worktree);
    } catch {
      return { upstream: null, pushed: false };
    }
    const slash = baseRef.indexOf('/');
    const baseRemote = slash > 0 ? baseRef.slice(0, slash) : '';
    const remote = remotes.includes(baseRemote)
      ? baseRemote
      : remotes.includes('origin')
        ? 'origin'
        : null;
    if (!remote) return { upstream: null, pushed: false };
    try {
      await this.run(worktree, [
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/remotes/${remote}/${branch}`,
      ]);
    } catch {
      return { upstream: null, pushed: false };
    }
    const upstream = `${remote}/${branch}`;
    try {
      await this.run(worktree, [
        'merge-base',
        '--is-ancestor',
        'HEAD',
        `refs/remotes/${upstream}`,
      ]);
      return { upstream, pushed: true };
    } catch {
      return { upstream, pushed: false };
    }
  }
}
