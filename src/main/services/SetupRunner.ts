import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SetupEvent, SetupStepDef } from '../../shared/types';
import type { Platform } from '../platform/Platform';
import type { GitClient } from './GitClient';

/** The setup of a task without a task folder (older tasks): one repo, its worktree is the task's folder. */
export type SingleSetupPlan = {
  taskId: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  copy: string[];
  commands: string[];
  taskMd: string;
  startTerminalsLabel: string | null;
  updateWorkItem: boolean;
  /** Reopening a finished task: the worktree is made again for its branch (see Task.reopen). */
  restore?: { from: string | null };
  folder?: undefined;
  scope?: string;
};

/** One repo of a task folder: its worktree, and what to copy into it and run in it. */
export type RepoSetupPlan = {
  repoId: string;
  dir: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  copy: string[];
  commands: string[];
  /** Reopening: the worktree is made again for its branch, from the local branch (null) or this ref. */
  restore?: { from: string | null };
};

/** The setup of a task folder: the repos to make (all of the task's, or the one being added) and the task files. */
export type FolderSetupPlan = {
  taskId: string;
  folder: string;
  repos: RepoSetupPlan[];
  startTerminalsLabel: string | null;
  updateWorkItem: boolean;
  /** The repo being added to a running task; its events carry it as `repoId`. */
  scope?: string;
};

export type SetupPlan = SingleSetupPlan | FolderSetupPlan;

const isFolderPlan = (p: SetupPlan): p is FolderSetupPlan =>
  typeof p.folder === 'string';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type SetupHooks = {
  onEvent(e: SetupEvent): void;
  startTerminals(): Promise<void>;
  /** The commit a freshly made worktree's branch starts from; `repoId` for a task folder's repo. */
  onBaseSha?(sha: string, repoId?: string): Promise<void>;
  /** Moves the task's work item and assigns it; a thrown error becomes a warning. */
  updateWorkItem?: () => Promise<{ detail: string; warn: boolean }>;
  /** The files MIAC writes into a task folder (paths relative to it), built once the worktrees exist. */
  taskFiles?: () => Promise<{ rel: string; content: string }[]>;
  fromStep?: number;
};

type Work = { def: SetupStepDef; repo: RepoSetupPlan | null };

/** A single-repo plan as one repo with no folder name, so both kinds run the same steps. */
const singleRepo = (p: SingleSetupPlan): RepoSetupPlan => ({
  repoId: '',
  dir: '',
  repoPath: p.repoPath,
  worktreePath: p.worktreePath,
  branch: p.branch,
  baseRef: p.baseRef,
  copy: p.copy,
  commands: p.commands,
  ...(p.restore ? { restore: p.restore } : {}),
});

function planWork(plan: SetupPlan): Work[] {
  const folder = isFolderPlan(plan);
  const repos = folder ? plan.repos : [singleRepo(plan)];
  const at = (r: RepoSetupPlan, text: string) =>
    folder ? `${r.dir}: ${text}` : text;
  const work: Work[] = [];
  for (const r of repos) {
    if (r.restore)
      work.push({
        repo: r,
        def: {
          kind: 'worktree',
          label: 'Restore worktree',
          detail: at(
            r,
            r.restore.from ? `${r.branch} from ${r.restore.from}` : r.branch,
          ),
        },
      });
    else
      work.push(
        {
          repo: r,
          def: { kind: 'fetch', label: 'Fetch base', detail: at(r, r.baseRef) },
        },
        {
          repo: r,
          def: {
            kind: 'worktree',
            label: 'Create branch and worktree',
            detail: at(r, r.branch),
          },
        },
      );
  }
  if (plan.updateWorkItem)
    work.push({
      repo: null,
      def: {
        kind: 'work-item',
        label: 'Update work item',
        detail: 'Move to In Progress',
      },
    });
  for (const r of repos)
    if (r.copy.length > 0)
      work.push({
        repo: r,
        def: {
          kind: 'copy',
          label: 'Copy local files',
          detail: at(r, r.copy.join(', ')),
        },
      });
  work.push({
    repo: folder ? null : repos[0],
    def: folder
      ? {
          kind: 'task-file',
          label: 'Write task files',
          detail: 'CLAUDE.md, .miac/task.md',
        }
      : {
          kind: 'task-file',
          label: 'Write task file',
          detail: '.miac/task.md',
        },
  });
  for (const r of repos)
    for (const command of r.commands)
      work.push({
        repo: r,
        def: {
          kind: 'command',
          label: command,
          detail: folder ? `in ${r.dir}` : 'in worktree',
          command,
        },
      });
  if (plan.startTerminalsLabel)
    work.push({
      repo: null,
      def: {
        kind: 'terminals',
        label: repos.some((r) => r.restore)
          ? 'Restore terminals'
          : 'Start terminals',
        detail: plan.startTerminalsLabel,
      },
    });
  return work;
}

export function planSteps(plan: SetupPlan): SetupStepDef[] {
  return planWork(plan).map((w) => w.def);
}

/** Adds a pattern to the repository's .git/info/exclude (shared by all worktrees) if it is not there yet. */
export async function ensureExcluded(
  git: GitClient,
  repoPath: string,
  pattern: string,
): Promise<void> {
  const common = await git.commonDir(repoPath);
  const file = path.join(common, 'info', 'exclude');
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Serialise check-then-append per file within this process; appending (never rewriting) keeps other writers' lines.
  const previous = excludeLocks.get(file) ?? Promise.resolve();
  const current = previous.then(async () => {
    let text = '';
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (text.split('\n').some((l) => l.trim() === pattern)) return;
    const sep = text.length === 0 || text.endsWith('\n') ? '' : '\n';
    await fs.appendFile(file, `${sep}${pattern}\n`, 'utf8');
  });
  const tail = current.catch(() => {});
  excludeLocks.set(file, tail);
  try {
    await current;
  } finally {
    if (excludeLocks.get(file) === tail) excludeLocks.delete(file);
  }
}

const excludeLocks = new Map<string, Promise<void>>();

function insideDir(base: string, rel: string): string | null {
  const root = path.resolve(base);
  const target = path.resolve(root, rel);
  return target === root || target.startsWith(root + path.sep) ? target : null;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export class SetupRunner {
  constructor(
    private readonly git: GitClient,
    private readonly platform: Platform,
  ) {}

  async run(
    plan: SetupPlan,
    hooks: SetupHooks,
  ): Promise<{ ok: boolean; failedStep?: number }> {
    const work = planWork(plan);
    const from = hooks.fromStep ?? 0;
    if (from < 0 || from >= work.length) {
      throw new Error(
        `Cannot retry from step ${from}: the plan has ${work.length} steps`,
      );
    }
    const scope = plan.scope ? { repoId: plan.scope } : {};
    const emit = (e: DistributiveOmit<SetupEvent, 'taskId' | 'repoId'>) =>
      hooks.onEvent({ taskId: plan.taskId, ...scope, ...e } as SetupEvent);
    const log = (line: string) => emit({ type: 'log', line });

    for (let index = 0; index < work.length; index++) {
      if (index < from) {
        emit({ type: 'step', index, status: 'done' });
        continue;
      }
      emit({ type: 'step', index, status: 'running' });
      const started = Date.now();
      try {
        const out = await this.execute(work[index], plan, hooks, log);
        emit({
          type: 'step',
          index,
          status: out && out.warn ? 'warn' : 'done',
          ...(out && out.detail ? { detail: out.detail } : {}),
          ms: Date.now() - started,
        });
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        log(detail);
        emit({
          type: 'step',
          index,
          status: 'failed',
          detail,
          ms: Date.now() - started,
        });
        emit({ type: 'finished', ok: false, failedStep: index });
        return { ok: false, failedStep: index };
      }
    }
    emit({ type: 'finished', ok: true });
    return { ok: true };
  }

  private async execute(
    { def: step, repo }: Work,
    plan: SetupPlan,
    hooks: SetupHooks,
    log: (l: string) => void,
  ): Promise<{ detail?: string; warn?: boolean } | void> {
    switch (step.kind) {
      case 'fetch': {
        const r = repo!;
        log(`$ git fetch ${r.baseRef}`);
        const fetched = await this.git.fetch(r.repoPath, r.baseRef);
        if (!fetched) log(`${r.baseRef} has no remote, nothing to fetch`);
        return;
      }
      case 'worktree': {
        const r = repo!;
        if (
          (await exists(r.worktreePath)) &&
          (await this.git.branchExists(r.repoPath, r.branch))
        ) {
          log(`worktree ${r.worktreePath} already exists, reusing it`);
          return;
        }
        if (r.restore) {
          // The branch keeps its original base: no onBaseSha.
          if (r.restore.from === null) {
            log(`$ git worktree add ${r.worktreePath} ${r.branch}`);
            await this.git.worktreeAddExisting(r.repoPath, {
              branch: r.branch,
              path: r.worktreePath,
            });
          } else {
            log(
              `$ git worktree add -b ${r.branch} ${r.worktreePath} ${r.restore.from}`,
            );
            await this.git.worktreeAdd(r.repoPath, {
              branch: r.branch,
              path: r.worktreePath,
              baseRef: r.restore.from,
            });
          }
          return;
        }
        log(`$ git worktree add -b ${r.branch} ${r.worktreePath} ${r.baseRef}`);
        const sha = await this.git.worktreeAdd(r.repoPath, {
          branch: r.branch,
          path: r.worktreePath,
          baseRef: r.baseRef,
        });
        await hooks.onBaseSha?.(sha, ...(isFolderPlan(plan) ? [r.repoId] : []));
        return;
      }
      case 'work-item': {
        if (!hooks.updateWorkItem) return { detail: 'Skipped' };
        try {
          const r = await hooks.updateWorkItem();
          log(r.detail);
          return r;
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          log(detail);
          return { detail, warn: true };
        }
      }
      case 'copy': {
        const r = repo!;
        for (const rel of r.copy) {
          const src = insideDir(r.repoPath, rel);
          const dest = insideDir(r.worktreePath, rel);
          if (src === null || dest === null) {
            log(`skipped ${rel} (outside the repository)`);
            continue;
          }
          if (!(await exists(src))) {
            log(`skipped ${rel} (not present in ${path.basename(r.repoPath)})`);
            continue;
          }
          await fs.cp(src, dest, {
            recursive: true,
          });
          log(`copied ${rel}`);
        }
        return;
      }
      case 'task-file':
        if (isFolderPlan(plan)) {
          const files = (await hooks.taskFiles?.()) ?? [];
          for (const f of files) {
            const dest = insideDir(plan.folder, f.rel);
            if (dest === null || dest === path.resolve(plan.folder))
              throw new Error(`${f.rel} is outside the task folder`);
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.writeFile(dest, f.content, 'utf8');
            log(`wrote ${f.rel}`);
          }
          return;
        }
        await fs.mkdir(path.join(plan.worktreePath, '.miac'), {
          recursive: true,
        });
        await fs.writeFile(
          path.join(plan.worktreePath, '.miac', 'task.md'),
          plan.taskMd,
          'utf8',
        );
        await ensureExcluded(this.git, plan.repoPath, '.miac/');
        log('wrote .miac/task.md');
        return;
      case 'command':
        log(`$ ${step.command}`);
        await this.runCommand(step.command ?? '', repo!.worktreePath, log);
        return;
      case 'terminals':
        await hooks.startTerminals();
        return;
    }
  }

  private runCommand(
    cmd: string,
    cwd: string,
    log: (l: string) => void,
  ): Promise<void> {
    const { command, args, env } = this.platform.shellCommand(cmd);
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const pipe = (stream: NodeJS.ReadableStream) => {
        let buf = '';
        stream.on('data', (chunk: Buffer | string) => {
          buf += chunk.toString();
          let nl = buf.indexOf('\n');
          while (nl >= 0) {
            log(buf.slice(0, nl).replace(/\r$/, ''));
            buf = buf.slice(nl + 1);
            nl = buf.indexOf('\n');
          }
        });
        stream.on('end', () => {
          if (buf.length > 0) log(buf);
        });
      };
      pipe(child.stdout);
      pipe(child.stderr);
      child.on('error', reject);
      child.on('close', (code, signal) => {
        if (code === 0) resolve();
        else if (code === null)
          reject(new Error(`${cmd} was killed by signal ${signal}`));
        else reject(new Error(`${cmd} exited with code ${code}`));
      });
    });
  }
}
