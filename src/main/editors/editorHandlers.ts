// src/main/editors/editorHandlers.ts
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { EditorIdSchema } from '../../shared/editors';
import type { Handlers } from '../../shared/ipc';
import type { Task } from '../../shared/types';
import { workspaceById } from '../../shared/workspaces';
import { resolveInWorktree } from '../docs/worktreeFiles';
import type { EditorService } from './EditorService';

type EditorChannels =
  | 'editor:installed'
  | 'editor:options'
  | 'editor:openFolder'
  | 'editor:openFile';

const OpenSchema = z.object({
  editorId: EditorIdSchema.optional(),
  solution: z.string().min(1).max(1000).optional(),
});
const Line = z.number().int().min(1).optional();

export function createEditorHandlers(d: {
  taskById: (id: string) => Task;
  editors: EditorService;
}): Pick<Handlers, EditorChannels> {
  const worktree = (taskId: string, workspaceId: string | undefined) => {
    const ws = workspaceById(d.taskById(taskId), workspaceId);
    if (!existsSync(ws.worktreePath))
      throw new Error('The worktree is missing');
    return ws;
  };
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
