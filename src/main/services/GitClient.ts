import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitSummary } from '../../shared/types';

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

/** Thin wrapper over the git CLI. Every method takes the directory to run in. */
export class GitClient {
  async run(cwd: string, args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        maxBuffer: 16 * 1024 * 1024,
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
      return (await this.run(dir, ['rev-parse', '--show-toplevel'])).trim();
    } catch {
      return null;
    }
  }

  /** The shared .git directory, also from inside a linked worktree. */
  async commonDir(cwd: string): Promise<string> {
    const out = (await this.run(cwd, ['rev-parse', '--git-common-dir'])).trim();
    return path.resolve(cwd, out);
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
    await this.run(cwd, ['worktree', 'add', '-b', o.branch, o.path, o.baseRef]);
  }

  async worktreeRemove(
    cwd: string,
    worktreePath: string,
    force: boolean,
  ): Promise<void> {
    await this.run(cwd, [
      'worktree',
      'remove',
      ...(force ? ['--force'] : []),
      worktreePath,
    ]);
  }

  async deleteBranch(cwd: string, branch: string): Promise<void> {
    await this.run(cwd, ['branch', '-D', branch]);
  }

  async summary(worktree: string, baseRef: string): Promise<GitSummary> {
    const out = await this.run(worktree, [
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
}
