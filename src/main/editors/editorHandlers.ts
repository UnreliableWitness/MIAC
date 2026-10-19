// src/main/editors/editorHandlers.ts
import { z } from 'zod';
import { EditorIdSchema } from '../../shared/editors';
import type { Handlers } from '../../shared/ipc';
import type { Task } from '../../shared/types';
import { resolveInWorktree } from '../docs/worktreeFiles';
import { existingWorkspace } from '../workspaces/existing';
import type { EditorService } from './EditorService';

type EditorChannels =
  | 'editor:installed'
  | 'editor:options'
  | 'editor:openFolder'
  | 'editor:showFolder'
  | 'editor:openFile';

const OpenSchema = z.object({
  editorId: EditorIdSchema.optional(),
  solution: z.string().min(1).max(1000).optional(),
});
const Line = z.number().int().min(1).optional();

export function createEditorHandlers(d: {
  taskById: (id: string) => Task;
  editors: EditorService;
  /** Opens a folder in the system file manager. */
  showFolder: (absPath: string) => Promise<void>;
}): Pick<Handlers, EditorChannels> {
  const worktree = (taskId: string, workspaceId: string | undefined) =>
    existingWorkspace(d.taskById(taskId), workspaceId);
  return {
    'editor:installed': async (refresh) => d.editors.choices(Boolean(refresh)),
    'editor:options': async (taskId, workspaceId) => {
      const ws = worktree(taskId, workspaceId);
      return d.editors.options(ws.repoId, ws.worktreePath);
    },
    'editor:openFolder': async (taskId, workspaceId, o) => {
      const ws = worktree(taskId, workspaceId);
      await d.editors.openFolder(
        ws.repoId,
        ws.worktreePath,
        OpenSchema.parse(o ?? {}),
      );
    },
    'editor:showFolder': async (taskId, workspaceId) => {
      await d.showFolder(worktree(taskId, workspaceId).worktreePath);
      d.editors.folderShown();
    },
    'editor:openFile': async (taskId, workspaceId, rel, line, editorId) => {
      const ws = worktree(taskId, workspaceId);
      const abs = await resolveInWorktree(ws.worktreePath, rel);
      await d.editors.openFile(
        ws.repoId,
        ws.worktreePath,
        abs,
        Line.parse(line),
        undefined,
        editorId === undefined ? undefined : EditorIdSchema.parse(editorId),
      );
    },
  };
}
