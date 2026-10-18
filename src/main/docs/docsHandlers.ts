import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { Handlers } from '../../shared/ipc';
import type { TelemetryProps } from '../../shared/telemetry';
import type { Task } from '../../shared/types';
import {
  activeHome,
  activeWorkspaces,
  parseDocsTarget,
  type WorkspaceView,
  workspaceById,
} from '../../shared/workspaces';
import type { GitClient } from '../services/GitClient';
import { requireWorktree } from '../workspaces/existing';
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

const Position = z.number().int().min(1).optional();

export type DocsDeps = {
  taskById: (id: string) => Task;
  git: GitClient;
  /** Opens a file of the workspace at a line in the developer's editor (EditorService). */
  openFile: (
    ws: WorkspaceView,
    absFile: string,
    line?: number,
    col?: number,
  ) => Promise<void>;
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
  /** The task and workspace a docs target names; a plain task id is the active home. */
  const resolveTarget = (target: string) => {
    const { taskId, workspaceId } = parseDocsTarget(target);
    const t = d.taskById(taskId);
    if (t.status !== 'ready')
      throw new Error(`Cannot read docs of a task that is ${t.status}`);
    return { t, ws: workspaceById(t, workspaceId), workspaceId };
  };
  const workspace = (target: string) =>
    requireWorktree(resolveTarget(target).ws);
  const worktree = (target: string): string => workspace(target).worktreePath;
  return {
    'docs:list': async (target) => {
      const ws = workspace(target);
      return { files: await listDocs(d.git, ws.worktreePath, ws.baseSha) };
    },
    'docs:read': async (target, p) => readDoc(worktree(target), p),
    'docs:asset': async (target, p) => readAsset(worktree(target), p),
    'docs:resolve': async (target, p) => {
      const { t, ws, workspaceId } = resolveTarget(target);
      if (workspaceId !== undefined) {
        if (!existsSync(ws.worktreePath)) return null;
        const r = await resolveLink(ws.worktreePath, p);
        return r && { ...r, workspaceId };
      }
      // A plain task id: the active home first, then the other active workspaces.
      const home = activeHome(t);
      const order = [home, ...activeWorkspaces(t).filter((w) => w !== home)];
      for (const w of order) {
        if (!existsSync(w.worktreePath)) continue;
        const r = await resolveLink(w.worktreePath, p);
        if (r) return w === home ? r : { ...r, workspaceId: w.id };
      }
      return null;
    },
    'docs:openInEditor': async (target, p, line, col) => {
      const at = Position.parse(line);
      const column = Position.parse(col);
      const ws = workspace(target);
      const abs = await resolveInWorktree(ws.worktreePath, p);
      await d.openFile(ws, abs, at, column);
    },
    'docs:reveal': async (target, p) => {
      d.revealFile(await resolveInWorktree(worktree(target), p));
    },
    'docs:watch': async (target, on) => {
      if (!on) {
        d.watcher.stop(target);
        return { live: false };
      }
      return { live: d.watcher.start(target, worktree(target)) };
    },
    'links:open': async (url) => {
      if (!allowedLink(url)) throw new Error(`Opening ${url} is not allowed`);
      await d.openExternal(url);
    },
  };
}
