import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SetupEvent, SetupStepDef } from '../../shared/types';
import type { Platform } from '../platform/Platform';
import type { GitClient } from './GitClient';

export type SetupPlan = {
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
  /** Reopen: skip the home's worktree, copy, task-file and command steps (home dropped, or its worktree kept). */
  skipHome?: boolean;
  /** Reopen: the task's other repos whose worktrees are made again, each with its own copies and setup commands. */
  extraRestores?: ExtraRestore[];
};

export type ExtraRestore = {
  workspaceId: string;
  repoName: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  from: string | null;
  copy: string[];
  commands: string[];
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type SetupHooks = {
  onEvent(e: SetupEvent): void;
  startTerminals(): Promise<void>;
  /** The commit a freshly made worktree's branch starts from. */
  onBaseSha?(sha: string): Promise<void>;
  /** Moves the task's work item and assigns it; a thrown error becomes a warning. */
  updateWorkItem?: () => Promise<{ detail: string; warn: boolean }>;
  fromStep?: number;
};

export function planSteps(plan: SetupPlan): SetupStepDef[] {
  const steps: SetupStepDef[] = [];
  if (!plan.skipHome) {
    if (plan.restore)
      steps.push({
        kind: 'worktree',
        label: 'Restore worktree',
        detail: restoreDetail(plan.branch, plan.restore.from),
      });
    else
      steps.push(
        { kind: 'fetch', label: 'Fetch base', detail: plan.baseRef },
        {
          kind: 'worktree',
          label: 'Create branch and worktree',
          detail: plan.branch,
        },
      );
  }
  if (plan.updateWorkItem)
    steps.push({
      kind: 'work-item',
      label: 'Update work item',
      detail: 'Move to In Progress',
    });
  if (!plan.skipHome) {
    if (plan.copy.length > 0)
      steps.push({
        kind: 'copy',
        label: 'Copy local files',
        detail: plan.copy.join(', '),
      });
    steps.push({
      kind: 'task-file',
      label: 'Write task file',
      detail: '.miac/task.md',
    });
    for (const command of plan.commands)
      steps.push({
        kind: 'command',
        label: command,
        detail: 'in worktree',
        command,
      });
  }
  for (const x of plan.extraRestores ?? []) {
    const workspaceId = x.workspaceId;
    steps.push({
      kind: 'worktree',
      label: `Restore ${x.repoName} worktree`,
      detail: restoreDetail(x.branch, x.from),
      workspaceId,
    });
    if (x.copy.length > 0)
      steps.push({
        kind: 'copy',
        label: `Copy local files (${x.repoName})`,
        detail: x.copy.join(', '),
        workspaceId,
      });
    for (const command of x.commands)
      steps.push({
        kind: 'command',
        label: command,
        detail: `in ${x.repoName}`,
        command,
        workspaceId,
      });
  }
  if (plan.startTerminalsLabel)
    steps.push({
      kind: 'terminals',
      label:
        plan.restore || plan.skipHome ? 'Restore terminals' : 'Start terminals',
      detail: plan.startTerminalsLabel,
    });
  return steps;
}

const restoreDetail = (branch: string, from: string | null) =>
  from ? `${branch} from ${from}` : branch;

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
    const steps = planSteps(plan);
    const from = hooks.fromStep ?? 0;
    if (from < 0 || from >= steps.length) {
      throw new Error(
        `Cannot retry from step ${from}: the plan has ${steps.length} steps`,
      );
    }
    const emit = (e: DistributiveOmit<SetupEvent, 'taskId'>) =>
      hooks.onEvent({ taskId: plan.taskId, ...e } as SetupEvent);
    const log = (line: string) => emit({ type: 'log', line });

    for (let index = 0; index < steps.length; index++) {
      if (index < from) {
        emit({ type: 'step', index, status: 'done' });
        continue;
      }
      emit({ type: 'step', index, status: 'running' });
      const started = Date.now();
      try {
        const out = await this.execute(steps[index], plan, hooks, log);
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
    step: SetupStepDef,
    plan: SetupPlan,
    hooks: SetupHooks,
    log: (l: string) => void,
  ): Promise<{ detail?: string; warn?: boolean } | void> {
    if (step.workspaceId !== undefined) {
      const x = plan.extraRestores?.find(
        (r) => r.workspaceId === step.workspaceId,
      );
      if (!x) throw new Error(`Unknown workspace ${step.workspaceId}`);
      if (step.kind === 'worktree') return this.restoreWorktree(x, x.from, log);
      if (step.kind === 'copy') return this.copyFiles(x, x.copy, log);
      log(`$ ${step.command}`);
      return this.runCommand(step.command ?? '', x.worktreePath, log);
    }
    switch (step.kind) {
      case 'fetch': {
        log(`$ git fetch ${plan.baseRef}`);
        const fetched = await this.git.fetch(plan.repoPath, plan.baseRef);
        if (!fetched) log(`${plan.baseRef} has no remote, nothing to fetch`);
        return;
      }
      case 'worktree':
        if (plan.restore)
          return this.restoreWorktree(plan, plan.restore.from, log);
        if (await this.reusable(plan, log)) return;
        log(
          `$ git worktree add -b ${plan.branch} ${plan.worktreePath} ${plan.baseRef}`,
        );
        {
          const sha = await this.git.worktreeAdd(plan.repoPath, {
            branch: plan.branch,
            path: plan.worktreePath,
            baseRef: plan.baseRef,
          });
          await hooks.onBaseSha?.(sha);
        }
        return;
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
      case 'copy':
        return this.copyFiles(plan, plan.copy, log);
      case 'task-file':
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
        await this.runCommand(step.command ?? '', plan.worktreePath, log);
        return;
      case 'terminals':
        await hooks.startTerminals();
        return;
    }
  }

  /** A worktree left by an earlier run of this setup is used as it is. */
  private async reusable(
    w: { repoPath: string; worktreePath: string; branch: string },
    log: (l: string) => void,
  ): Promise<boolean> {
    if (
      (await exists(w.worktreePath)) &&
      (await this.git.branchExists(w.repoPath, w.branch))
    ) {
      log(`worktree ${w.worktreePath} already exists, reusing it`);
      return true;
    }
    return false;
  }

  /** Makes a reopened workspace's worktree again; the branch keeps its original base (no onBaseSha). */
  private async restoreWorktree(
    w: { repoPath: string; worktreePath: string; branch: string },
    from: string | null,
    log: (l: string) => void,
  ): Promise<void> {
    if (await this.reusable(w, log)) return;
    if (from === null) {
      log(`$ git worktree add ${w.worktreePath} ${w.branch}`);
      await this.git.worktreeAddExisting(w.repoPath, {
        branch: w.branch,
        path: w.worktreePath,
      });
      return;
    }
    log(`$ git worktree add -b ${w.branch} ${w.worktreePath} ${from}`);
    await this.git.worktreeAdd(w.repoPath, {
      branch: w.branch,
      path: w.worktreePath,
      baseRef: from,
    });
  }

  private async copyFiles(
    w: { repoPath: string; worktreePath: string },
    copy: string[],
    log: (l: string) => void,
  ): Promise<void> {
    for (const rel of copy) {
      const src = insideDir(w.repoPath, rel);
      const dest = insideDir(w.worktreePath, rel);
      if (src === null || dest === null) {
        log(`skipped ${rel} (outside the repository)`);
        continue;
      }
      if (!(await exists(src))) {
        log(`skipped ${rel} (not present in ${path.basename(w.repoPath)})`);
        continue;
      }
      await fs.cp(src, dest, {
        recursive: true,
      });
      log(`copied ${rel}`);
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
