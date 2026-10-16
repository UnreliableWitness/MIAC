import { existsSync } from 'node:fs';
import type { Handlers } from '../../shared/ipc';
import type { TelemetryProps } from '../../shared/telemetry';
import type { Task } from '../../shared/types';
import type { Command } from '../platform/Platform';
import type { GitClient } from '../services/GitClient';
import type { DocsWatcher } from './DocsWatcher';
import {
  listDocs,
  readAsset,
  readDoc,
  resolveInWorktree,
  resolveLink,
} from './worktreeFiles';

type DocsChannels =
  | 'docs:list'
  | 'docs:read'
  | 'docs:asset'
  | 'docs:resolve'
  | 'docs:openInEditor'
  | 'docs:reveal'
  | 'docs:watch'
  | 'links:open';

export type DocsDeps = {
  taskById: (id: string) => Task;
  git: GitClient;
  editorGoto: (
    worktree: string,
    file: string,
    line?: number,
    col?: number,
  ) => Command;
  launch: (cmd: Command) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  revealFile: (absPath: string) => void;
  watcher: DocsWatcher;
  event: (name: string, props?: TelemetryProps) => void;
};

/** Web links clicked in a terminal or a document: http(s) only, no credentials in the URL. */
export function allowedLink(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.protocol === 'http:' || u.protocol === 'https:') &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}

export function createDocsHandlers(d: DocsDeps): Pick<Handlers, DocsChannels> {
  const worktree = (taskId: string): string => {
    const t = d.taskById(taskId);
    if (t.status !== 'ready')
      throw new Error(`Cannot read docs of a task that is ${t.status}`);
    if (!existsSync(t.worktreePath)) throw new Error('The worktree is missing');
    return t.worktreePath;
  };
  return {
    'docs:list': async (taskId) => ({
      files: await listDocs(
        d.git,
        worktree(taskId),
        d.taskById(taskId).baseSha,
      ),
    }),
    'docs:read': async (taskId, p) => readDoc(worktree(taskId), p),
    'docs:asset': async (taskId, p) => readAsset(worktree(taskId), p),
    'docs:resolve': async (taskId, p) => resolveLink(worktree(taskId), p),
    'docs:openInEditor': async (taskId, p, line, col) => {
      const wt = worktree(taskId);
      const abs = await resolveInWorktree(wt, p);
      await d.launch(d.editorGoto(wt, abs, line, col));
      d.event('editor.opened', { at: 'file' });
    },
    'docs:reveal': async (taskId, p) => {
      d.revealFile(await resolveInWorktree(worktree(taskId), p));
    },
    'docs:watch': async (taskId, on) => {
      if (!on) {
        d.watcher.stop(taskId);
        return { live: false };
      }
      return { live: d.watcher.start(taskId, worktree(taskId)) };
    },
    'links:open': async (url) => {
      if (!allowedLink(url)) throw new Error(`Opening ${url} is not allowed`);
      await d.openExternal(url);
    },
  };
}
