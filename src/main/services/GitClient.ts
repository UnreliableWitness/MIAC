import { execFile, type ExecFileOptions } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitSummary, TaskSummary } from '../../shared/types';
import { realWait, withRetry, type Wait } from '../fsRetry';
import { nativePath } from '../paths';

const execFileAsync = promisify(execFile);

/** Long enough for an interactive Git Credential Manager sign-in, short enough that Finish never hangs. */
const PUSH_TIMEOUT_MS = 120_000;

/** Fails ssh instead of waiting on a passphrase or host-key question no one can see. Agent keys still work. */
const BATCH_SSH = 'ssh -o BatchMode=yes';

class GitTimeoutError extends Error {}

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
  readonly pushTimeoutMs: number;

  constructor(
    private readonly wait: Wait = realWait,
    opts: { pushTimeoutMs?: number } = {},
  ) {
    this.pushTimeoutMs = opts.pushTimeoutMs ?? PUSH_TIMEOUT_MS;
  }

  async run(
    cwd: string,
    args: string[],
    opts: { timeoutMs?: number; env?: Record<string, string> } = {},
  ): Promise<string> {
    try {
      const options = {
        cwd,
        env: { ...process.env, ...opts.env, GIT_TERMINAL_PROMPT: '0' },
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      };
      if (opts.timeoutMs === undefined)
        return (await execFileAsync('git', args, options)).stdout;
      return await execWithTimeout(args, options, opts.timeoutMs);
    } catch (e) {
      if (e instanceof GitTimeoutError) throw e;
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

  /** Whether a ref (e.g. refs/remotes/origin/x) or commit sha resolves to a commit. */
  async commitExists(cwd: string, ref: string): Promise<boolean> {
    try {
      await this.run(cwd, [
        'rev-parse',
        '--verify',
        '--quiet',
        `${ref}^{commit}`,
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

  /** `git worktree list --porcelain`: every worktree (the main checkout first) with its branch, null when detached. */
  async worktreeList(
    cwd: string,
  ): Promise<{ path: string; branch: string | null }[]> {
    const out = await this.run(cwd, ['worktree', 'list', '--porcelain']);
    const list: { path: string; branch: string | null }[] = [];
    for (const block of out.split(/\r?\n\r?\n/)) {
      let wt: string | null = null;
      let branch: string | null = null;
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) wt = line.slice('worktree '.length);
        else if (line.startsWith('branch '))
          branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      }
      if (wt) list.push({ path: nativePath(wt), branch });
    }
    return list;
  }

  async mergeBase(cwd: string, a: string, b: string): Promise<string | null> {
    try {
      return (await this.run(cwd, ['merge-base', a, b])).trim() || null;
    } catch {
      return null;
    }
  }

  /** The ref a task branches from: origin's HEAD branch, else origin/main or origin/master, else local main or master, else HEAD. */
  async defaultBaseRef(cwd: string): Promise<string> {
    try {
      const head = (
        await this.run(cwd, [
          'symbolic-ref',
          '--short',
          'refs/remotes/origin/HEAD',
        ])
      ).trim();
      if (head && (await this.commitExists(cwd, `refs/remotes/${head}`)))
        return head;
    } catch {
      // no origin/HEAD
    }
    for (const ref of ['origin/main', 'origin/master'])
      if (await this.commitExists(cwd, `refs/remotes/${ref}`)) return ref;
    for (const b of ['main', 'master'])
      if (await this.branchExists(cwd, b)) return b;
    return 'HEAD';
  }

  /** The checked-out branch, or null when detached. */
  async currentBranch(cwd: string): Promise<string | null> {
    try {
      return (await this.run(cwd, ['branch', '--show-current'])).trim() || null;
    } catch {
      return null;
    }
  }

  async worktreeAdd(
    cwd: string,
    o: { branch: string; path: string; baseRef: string },
  ): Promise<string> {
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
    return (await this.run(o.path, ['rev-parse', 'HEAD'])).trim();
  }

  /** A worktree for a branch that already exists (reopening a finished task). */
  async worktreeAddExisting(
    cwd: string,
    o: { branch: string; path: string },
  ): Promise<void> {
    await this.run(cwd, [
      '-c',
      'core.longpaths=true',
      'worktree',
      'add',
      o.path,
      o.branch,
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

  /** The URL of a remote, or null when there is no such remote. */
  async remoteUrl(cwd: string, remote: string): Promise<string | null> {
    try {
      return (
        (await this.run(cwd, ['remote', 'get-url', remote])).trim() || null
      );
    } catch {
      return null;
    }
  }

  /**
   * Pushes a branch and sets its upstream. Never forces; a failure throws git's own stderr. Runs without a
   * console, so ssh runs in batch mode (unless the user set their own ssh command) and the push gives up
   * after `pushTimeoutMs`. Git Credential Manager stays on: users sign in through it.
   */
  async push(cwd: string, remote: string, branch: string): Promise<void> {
    const env: Record<string, string> = (await this.hasOwnSshCommand(cwd))
      ? {}
      : { GIT_SSH_COMMAND: BATCH_SSH };
    try {
      await this.run(cwd, ['push', '-u', remote, branch], {
        timeoutMs: this.pushTimeoutMs,
        env,
      });
    } catch (e) {
      if (e instanceof GitTimeoutError)
        throw new Error(
          `git push timed out after ${this.pushTimeoutMs / 1000} s (a credential prompt may be waiting)`,
        );
      throw e instanceof GitError ? new Error(e.stderr.trim()) : e;
    }
  }

  private async hasOwnSshCommand(cwd: string): Promise<boolean> {
    if (process.env.GIT_SSH_COMMAND || process.env.GIT_SSH) return true;
    const configured = await this.run(cwd, [
      'config',
      '--get',
      'core.sshCommand',
    ]).catch(() => '');
    return configured.trim() !== '';
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
   * What the task's branch did since it left its base: its commits (the newest 50, oldest first), the diff
   * stat, and whether it is pushed. The range starts at the recorded `baseSha`, else at the merge base with
   * `baseRef` (tasks from before MIAC recorded it). With neither, commits and changes are left unknown.
   */
  async finishSummary(
    worktree: string,
    o: { baseRef: string; baseSha: string | null; branch: string },
  ): Promise<TaskSummary> {
    const { baseRef, branch } = o;
    let base: string | null = null;
    if (o.baseSha) {
      try {
        base = (
          await this.run(worktree, [
            'rev-parse',
            '--verify',
            '--quiet',
            `${o.baseSha}^{commit}`,
          ])
        ).trim();
      } catch {
        base = null;
      }
    }
    if (!base) {
      try {
        base = (
          await this.run(worktree, ['merge-base', baseRef, 'HEAD'])
        ).trim();
      } catch {
        base = null;
      }
    }
    let commits: TaskSummary['commits'] = [];
    let commitCount = 0;
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;
    if (base) {
      const range = `${base}..HEAD`;
      commitCount =
        Number(
          (await this.run(worktree, ['rev-list', '--count', range])).trim(),
        ) || 0;
      const log = await this.run(worktree, [
        'log',
        `--max-count=${MAX_SUMMARY_COMMITS}`,
        '--format=%h%x09%s',
        range,
      ]);
      commits = log
        .split('\n')
        .filter(Boolean)
        .reverse()
        .map((l) => {
          const tab = l.indexOf('\t');
          return tab < 0
            ? { sha: l, subject: '' }
            : { sha: l.slice(0, tab), subject: l.slice(tab + 1) };
        });
      const stat = await this.run(worktree, ['diff', '--shortstat', range]);
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
      commitCount,
      filesChanged,
      insertions,
      deletions,
      pushed,
      upstream,
      baseKnown: base !== null,
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

/**
 * execFile with a deadline. On timeout it kills git and stops reading its pipes at once: a helper git
 * started (a credential prompt, ssh, a hook) can keep the pipes open long after git itself is gone.
 */
function execWithTimeout(
  args: string[],
  options: ExecFileOptions,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const child = execFile(
      'git',
      args,
      { ...options, windowsHide: true },
      (err, stdout, stderr) => {
        clearTimeout(timer);
        if (timedOut) return;
        if (err) reject(Object.assign(err, { stderr: String(stderr) }));
        else resolve(String(stdout));
      },
    );
    const timer = setTimeout(() => {
      timedOut = true;
      child.stdout?.destroy();
      child.stderr?.destroy();
      const fail = () =>
        reject(new GitTimeoutError(`git ${args[0]} timed out`));
      killTree(child.pid, () => child.kill(), fail);
    }, timeoutMs);
  });
}

/**
 * Kills a process and everything it started. On Windows, killing git.exe leaves its helpers (a credential
 * prompt, ssh, a hook's shell) running, and they keep the worktree locked, so taskkill /T takes the whole
 * tree; `done` runs once it has finished. Elsewhere `kill` is enough: open folders do not block removal.
 */
function killTree(
  pid: number | undefined,
  kill: () => void,
  done: () => void,
): void {
  if (process.platform !== 'win32' || pid === undefined) {
    kill();
    done();
    return;
  }
  execFile(
    'taskkill',
    ['/pid', String(pid), '/T', '/F'],
    { windowsHide: true },
    () => {
      kill();
      done();
    },
  );
}
