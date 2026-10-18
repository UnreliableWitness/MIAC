// src/shared/editors.ts
import { z } from 'zod';

export const EDITOR_IDS = ['vscode', 'visualstudio'] as const;
export const EditorIdSchema = z.enum(EDITOR_IDS);
export type EditorId = z.infer<typeof EditorIdSchema>;
export const EDITOR_LABELS: Record<EditorId, string> = {
  vscode: 'VS Code',
  visualstudio: 'Visual Studio',
};
export type EditorChoice = { id: EditorId; label: string };

/** A stored editor id this version does not know (removed, or from a newer Shellie) reads as no choice. */
const StoredEditorId = EditorIdSchema.nullable().default(null).catch(null);

/** Personal editor choices (settings.json, never `.shellie.yml`): a default and one per repo, with Visual Studio's solution. */
export const EditorPrefsSchema = z.object({
  default: StoredEditorId,
  repos: z
    .record(
      z.string(),
      z.object({
        editor: StoredEditorId,
        solution: z.string().nullable().default(null),
      }),
    )
    .default({}),
});
export type EditorPrefs = z.infer<typeof EditorPrefsSchema>;
export const defaultEditorPrefs = (): EditorPrefs => ({
  default: null,
  repos: {},
});

/** What the Open in editor button offers for one worktree. */
export type EditorOptions = {
  editors: EditorChoice[];
  chosen: EditorId | null;
  /** Visual Studio solutions (`.sln`, `.slnx`) in the worktree root or one folder down, relative. */
  solutions: string[];
  solution: string | null;
};

/** First installed of: the repo's choice, the global default, Visual Studio for a .NET repo, VS Code, anything. */
export function pickEditor(
  installed: EditorId[],
  prefs: { repo: EditorId | null; global: EditorId | null },
  hints: { dotnet: boolean },
): EditorId | null {
  const has = (id: EditorId | null): id is EditorId =>
    id !== null && installed.includes(id);
  if (has(prefs.repo)) return prefs.repo;
  if (has(prefs.global)) return prefs.global;
  if (hints.dotnet && has('visualstudio')) return 'visualstudio';
  if (has('vscode')) return 'vscode';
  return installed[0] ?? null;
}
