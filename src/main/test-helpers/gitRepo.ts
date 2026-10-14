import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
};

/** Temp folders created by makeRepo, removed by cleanupTempRepos. */
export const tempRoots: string[] = [];

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** A fresh repo with one commit on `main`, inside its own temp folder. Returns the real path (no /var symlink). */
export function makeRepo(name = 'repo'): string {
  const root = realpathSync.native(
    mkdtempSync(path.join(os.tmpdir(), 'miac-git-')),
  );
  tempRoots.push(root);
  const repo = path.join(root, name);
  git(root, 'init', '-q', '-b', 'main', name);
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'config', 'user.email', 'tests@miac.local');
  git(repo, 'config', 'user.name', 'MIAC tests');
  commitFile(repo, 'README.md', '# test\n');
  return repo;
}

export function commitFile(
  repo: string,
  name: string,
  content: string,
  message = `add ${name}`,
): void {
  writeFileSync(path.join(repo, name), content);
  git(repo, 'add', name);
  git(repo, 'commit', '-q', '-m', message);
}

/** Adds a bare `origin` next to the repo and pushes main to it. Returns the bare path. */
export function addOrigin(repo: string): string {
  const root = path.dirname(repo);
  git(root, 'init', '-q', '--bare', 'origin.git');
  const bare = path.join(root, 'origin.git');
  git(repo, 'remote', 'add', 'origin', bare);
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  return bare;
}

/** Removes every temp folder created by makeRepo. */
export function cleanupTempRepos(): void {
  for (const root of tempRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
}
