// src/main/editors/EditorService.ts
import {
  EDITOR_IDS,
  EDITOR_LABELS,
  type EditorChoice,
  type EditorId,
  type EditorOptions,
  type EditorPrefs,
  pickEditor,
} from '../../shared/editors';
import type { TelemetryProps } from '../../shared/telemetry';
import type { Command, Platform } from '../platform/Platform';
import {
  type Installed,
  visualStudioFile,
  visualStudioFolder,
} from './editors';

export type EditorServiceDeps = {
  platform: Pick<Platform, 'editorCommand' | 'editorGotoCommand'>;
  detect: () => Promise<Installed>;
  scan: (worktree: string) => Promise<{ solutions: string[]; dotnet: boolean }>;
  prefs: () => EditorPrefs;
  savePrefs: (prefs: EditorPrefs) => Promise<void>;
  launch: (cmd: Command) => Promise<void>;
  event: (name: string, props?: TelemetryProps) => void;
};

/** Picks and starts the developer's editor for a worktree; detection is cached until `choices(true)`. */
export class EditorService {
  private found: Promise<Installed> | null = null;

  constructor(private readonly d: EditorServiceDeps) {}

  private installed(refresh = false): Promise<Installed> {
    if (refresh || !this.found) this.found = this.d.detect().catch(() => ({}));
    return this.found;
  }

  async choices(refresh = false): Promise<EditorChoice[]> {
    const found = await this.installed(refresh);
    return EDITOR_IDS.filter((id) => found[id]).map((id) => ({
      id,
      label: EDITOR_LABELS[id],
    }));
  }

  async options(repoId: string, worktree: string): Promise<EditorOptions> {
    const [editors, project] = await Promise.all([
      this.choices(),
      this.d
        .scan(worktree)
        .catch(() => ({ solutions: [] as string[], dotnet: false })),
    ]);
    const prefs = this.d.prefs();
    const repo = prefs.repos[repoId];
    const chosen = pickEditor(
      editors.map((e) => e.id),
      { repo: repo?.editor ?? null, global: prefs.default },
      { dotnet: project.dotnet },
    );
    const remembered =
      repo?.solution && project.solutions.includes(repo.solution)
        ? repo.solution
        : null;
    return {
      editors,
      chosen,
      solutions: project.solutions,
      solution: remembered ?? project.solutions[0] ?? null,
    };
  }

  private async resolve(repoId: string, worktree: string, editorId?: EditorId) {
    const opts = await this.options(repoId, worktree);
    const id = editorId ?? opts.chosen;
    const exe = id ? (await this.installed())[id] : undefined;
    if (!id || !exe) throw new Error('No editor found. Pick one in Settings.');
    return { id, exe, opts };
  }

  async openFolder(
    repoId: string,
    worktree: string,
    o: { editorId?: EditorId; solution?: string } = {},
  ): Promise<void> {
    const { id, exe, opts } = await this.resolve(repoId, worktree, o.editorId);
    if (o.solution !== undefined && !opts.solutions.includes(o.solution))
      throw new Error('Unknown solution');
    if (id === 'vscode')
      await this.d.launch(this.d.platform.editorCommand(worktree));
    else
      await this.d.launch(
        visualStudioFolder(exe, worktree, o.solution ?? opts.solution),
      );
    if (o.solution !== undefined)
      await this.remember(repoId, { solution: o.solution });
    this.d.event('editor.opened', { editor: id, at: 'folder' });
  }

  async openFile(
    repoId: string,
    worktree: string,
    absFile: string,
    line?: number,
    col?: number,
    editorId?: EditorId,
  ): Promise<void> {
    const { id, exe } = await this.resolve(repoId, worktree, editorId);
    await this.d.launch(
      id === 'vscode'
        ? this.d.platform.editorGotoCommand(worktree, absFile, line, col)
        : visualStudioFile(exe, absFile, line),
    );
    this.d.event('editor.opened', { editor: id, at: 'file' });
  }

  private async remember(
    repoId: string,
    patch: { solution: string },
  ): Promise<void> {
    const prefs = this.d.prefs();
    const cur = prefs.repos[repoId] ?? { editor: null, solution: null };
    await this.d.savePrefs({
      ...prefs,
      repos: { ...prefs.repos, [repoId]: { ...cur, ...patch } },
    });
  }
}
