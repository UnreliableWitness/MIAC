import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  StartSettingsSchema,
  type Repo,
  type StartSettings,
} from '../../shared/types';
import type { GitClient } from './GitClient';
import { samePath } from '../paths';
import { loadShellieConfig } from './ShellieConfig';
import type { TaskStore } from './TaskStore';

export class RepoRegistry {
  constructor(
    private readonly store: TaskStore,
    private readonly git: GitClient,
    private readonly loadConfig: typeof loadShellieConfig = loadShellieConfig,
  ) {}

  list(): Repo[] {
    return this.store.state.repos;
  }

  get(id: string): Repo {
    const repo = this.store.state.repos.find((r) => r.id === id);
    if (!repo) throw new Error(`Unknown repo ${id}`);
    return repo;
  }

  async add(folder: string): Promise<Repo> {
    let real: string;
    try {
      real = await fs.realpath(folder);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`${folder} does not exist`);
      }
      throw e;
    }
    const top = await this.git.toplevel(real);
    if (!top) throw new Error(`${folder} is not a git repository`);
    if (this.store.state.repos.some((r) => samePath(r.path, top))) {
      throw new Error(`${path.basename(top)} is already registered`);
    }
    const repo = await this.describe({
      id: randomUUID(),
      path: top,
      connectionId: null,
    });
    // Re-check inside the update: a concurrent add may have registered the same path while we awaited.
    await this.store.update((s) => {
      if (s.repos.some((r) => samePath(r.path, top))) {
        throw new Error(`${path.basename(top)} is already registered`);
      }
      s.repos.push(repo);
    });
    return repo;
  }

  /** Registers a repo Shellie found in a task (`discovered`); a repo already registered is returned unchanged. */
  async addDiscovered(
    folder: string,
    connectionId: string | null,
  ): Promise<Repo> {
    const top = await this.git.toplevel(await fs.realpath(folder));
    if (!top) throw new Error(`${folder} is not a git repository`);
    const known = () =>
      this.store.state.repos.find((r) => samePath(r.path, top));
    const existing = known();
    if (existing) return existing;
    const repo = await this.describe({
      id: randomUUID(),
      path: top,
      connectionId,
      discovered: true,
    });
    await this.store.update((s) => {
      if (!s.repos.some((r) => samePath(r.path, top))) s.repos.push(repo);
    });
    return known() ?? repo;
  }

  /** Clearing the mark makes a discovered repo a normal one. */
  async setDiscovered(repoId: string, discovered: boolean): Promise<Repo> {
    this.get(repoId);
    await this.store.update((s) => {
      const r = s.repos.find((x) => x.id === repoId);
      if (r) r.discovered = discovered;
    });
    return this.get(repoId);
  }

  /** Re-reads name, base branch and .shellie.yml presence, e.g. after the user edits the file. */
  async setConnection(
    repoId: string,
    connectionId: string | null,
  ): Promise<Repo> {
    this.get(repoId);
    await this.store.update((s) => {
      const r = s.repos.find((x) => x.id === repoId);
      if (r) r.connectionId = connectionId;
    });
    return this.get(repoId);
  }

  async setWorkItemOnStart(
    repoId: string,
    settings: StartSettings,
  ): Promise<Repo> {
    this.get(repoId);
    const parsed = StartSettingsSchema.parse(settings);
    await this.store.update((s) => {
      const r = s.repos.find((x) => x.id === repoId);
      if (r) r.workItemOnStart = parsed;
    });
    return this.get(repoId);
  }

  async refresh(id: string): Promise<Repo> {
    const current = this.get(id);
    const repo = await this.describe(current);
    await this.store.update((s) => {
      const i = s.repos.findIndex((r) => r.id === id);
      if (i >= 0) s.repos[i] = repo;
    });
    return repo;
  }

  async remove(id: string): Promise<void> {
    const open = this.store.state.tasks.filter(
      (t) => t.repoId === id && t.status !== 'done',
    );
    if (open.length > 0)
      throw new Error(
        `Repo still has ${open.length} open task(s); finish them first`,
      );
    await this.store.update((s) => {
      s.repos = s.repos.filter((r) => r.id !== id);
    });
  }

  private async describe(
    base: Pick<Repo, 'id' | 'path' | 'connectionId'> &
      Partial<Pick<Repo, 'workItemOnStart' | 'discovered'>>,
  ): Promise<Repo> {
    const config = await this.loadConfig(base.path);
    return {
      id: base.id,
      name: path.basename(base.path),
      path: base.path,
      baseBranch: config.base,
      connectionId: base.connectionId,
      configFound: config.found,
      discovered: base.discovered ?? false,
      workItemOnStart: base.workItemOnStart ?? {
        moveToInProgress: true,
        assignToMe: true,
        stateOverrides: {},
      },
    };
  }
}
