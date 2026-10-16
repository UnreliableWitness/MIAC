import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SetupEvent, SetupStepDef } from '../../shared/types';
import type { Command, Platform } from '../platform/Platform';
import type { GitClient } from './GitClient';
import { nodeModulesMatch } from './nodeModules';

export type SetupPlan = {
  taskId: string;
  repoPath: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  copy: string[];
  /** Run in the task's Setup tab once the terminals start, not by the setup itself. */
  commands: string[];
  taskMd: string;
  /** The tabs setup opens (without the Setup tab), or null for none. */
  startTerminalsLabel: string | null;
  /** Clone the repo's node_modules into the worktree when it is up to date (see nodeModules.ts). */
  cloneNodeModules?: boolean;
  /** `apm install --target` targets, when the repo has an apm.yml. */
  apmTargets?: string[];
  updateWorkItem: boolean;
  /** Reopening a finished task: the worktree is made again for its branch (see Task.reopen). */
  restore?: { from: string | null };
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type SetupHooks = {
  onEvent(e: SetupEvent): void;
  /** Opens the task's tabs, plus a Setup tab running `commands` when there are any. */
  startTerminals(commands: string[]): Promise<void>;
  /** The commit a freshly made worktree's branch starts from. */
  onBaseSha?(sha: string): Promise<void>;
  /** Moves the task's work item and assigns it; a thrown error becomes a warning. */
  updateWorkItem?: () => Promise<{ detail: string; warn: boolean }>;
  fromStep?: number;
};

export function planSteps(plan: SetupPlan): SetupStepDef[] {
  const steps: SetupStepDef[] = plan.restore
    ? [
        {
          kind: 'worktree',
          label: 'Restore worktree',
          detail: plan.restore.from
            ? `${plan.branch} from ${plan.restore.from}`
            : plan.branch,
        },
      ]
    : [
        { kind: 'fetch', label: 'Fetch base', detail: plan.baseRef },
        {
          kind: 'worktree',
          label: 'Create branch and worktree',
          detail: plan.branch,
        },
      ];
  if (plan.updateWorkItem)
    steps.push({
      kind: 'work-item',
      label: 'Update work item',
      detail: 'Move to In Progress',
    });
  if (plan.copy.length > 0)
    steps.push({
      kind: 'copy',
      label: 'Copy local files',
      detail: plan.copy.join(', '),
    });
  if (plan.cloneNodeModules)
    steps.push({
      kind: 'node-modules',
      label: 'Clone node_modules',
      detail: `from ${path.basename(plan.repoPath)}`,
    });
  steps.push({
    kind: 'task-file',
    label: 'Write task file',
    detail: '.miac/task.md',
  });
  if (plan.apmTargets && plan.apmTargets.length > 0)
    steps.push({
      kind: 'apm',
      label: 'Install agent packages',
      detail: `apm install --target ${plan.apmTargets.join(', ')}`,
    });
  if (plan.startTerminalsLabel || plan.commands.length > 0)
    steps.push({
      kind: 'terminals',
      label: plan.restore ? 'Restore terminals' : 'Start terminals',
      detail: terminalsDetail(plan.startTerminalsLabel, plan.commands),
    });
  return steps;
}

const NPM_CI = 'npm ci';

function terminalsDetail(label: string | null, commands: string[]): string {
  return [label, commands.length > 0 ? `Setup (${commands.join(', ')})` : null]
    .filter(Boolean)
    .join(', ');
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
    switch (step.kind) {
      case 'fetch': {
        log(`$ git fetch ${plan.baseRef}`);
        const fetched = await this.git.fetch(plan.repoPath, plan.baseRef);
        if (!fetched) log(`${plan.baseRef} has no remote, nothing to fetch`);
        return;
      }
      case 'worktree':
        if (
          (await exists(plan.worktreePath)) &&
          (await this.git.branchExists(plan.repoPath, plan.branch))
        ) {
          log(`worktree ${plan.worktreePath} already exists, reusing it`);
          return;
        }
        if (plan.restore) {
          // The branch keeps its original base: no onBaseSha.
          if (plan.restore.from === null) {
            log(`$ git worktree add ${plan.worktreePath} ${plan.branch}`);
            await this.git.worktreeAddExisting(plan.repoPath, {
              branch: plan.branch,
              path: plan.worktreePath,
            });
          } else {
            log(
              `$ git worktree add -b ${plan.branch} ${plan.worktreePath} ${plan.restore.from}`,
            );
            await this.git.worktreeAdd(plan.repoPath, {
              branch: plan.branch,
              path: plan.worktreePath,
              baseRef: plan.restore.from,
            });
          }
          return;
        }
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
        for (const rel of plan.copy) {
          const src = insideDir(plan.repoPath, rel);
          const dest = insideDir(plan.worktreePath, rel);
          if (src === null || dest === null) {
            log(`skipped ${rel} (outside the repository)`);
            continue;
          }
          if (!(await exists(src))) {
            log(
              `skipped ${rel} (not present in ${path.basename(plan.repoPath)})`,
            );
            continue;
          }
          await fs.cp(src, dest, {
            recursive: true,
          });
          log(`copied ${rel}`);
        }
        return;
      case 'node-modules':
        return this.cloneNodeModules(plan, log);
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
      case 'apm':
        return this.installAgentPackages(plan, log);
      case 'terminals': {
        let commands = plan.commands;
        if (
          commands.some((c) => c.trim() === NPM_CI) &&
          (await nodeModulesMatch(
            path.join(plan.worktreePath, 'node_modules'),
            path.join(plan.worktreePath, 'package-lock.json'),
          ))
        ) {
          commands = commands.filter((c) => c.trim() !== NPM_CI);
          log('node_modules matches package-lock.json, npm ci skipped');
        }
        await hooks.startTerminals(commands);
        return {
          detail: terminalsDetail(plan.startTerminalsLabel, commands),
        };
      }
    }
  }

  /**
   * Clones the main checkout's node_modules when it is what `npm ci` would install for the worktree's lockfile.
   * The clone goes to a temporary folder first, so an interrupted clone never looks like an installed tree.
   */
  private async cloneNodeModules(
    plan: SetupPlan,
    log: (l: string) => void,
  ): Promise<{ detail: string; warn?: boolean }> {
    const name = path.basename(plan.repoPath);
    const src = path.join(plan.repoPath, 'node_modules');
    const dest = path.join(plan.worktreePath, 'node_modules');
    const outdated = `node_modules in ${name} is missing or out of date, npm ci installs`;
    if (await exists(dest)) {
      log('node_modules is already in the worktree');
      return { detail: 'Already in the worktree' };
    }
    if (
      !this.platform.cloneDir ||
      !(await exists(src)) ||
      !(await nodeModulesMatch(
        src,
        path.join(plan.worktreePath, 'package-lock.json'),
      ))
    ) {
      log(outdated);
      return { detail: outdated };
    }
    const tmp = `${dest}.miac-clone`;
    await fs.rm(tmp, { recursive: true, force: true });
    const cmd = this.platform.cloneDir(src, tmp);
    log(`cloning ${src}`);
    try {
      await this.spawnLogged(cmd, plan.worktreePath, log, 'clone');
      await fs.rename(tmp, dest);
    } catch (e) {
      await fs.rm(tmp, { recursive: true, force: true });
      const detail = `Clone failed, npm ci installs: ${e instanceof Error ? e.message : String(e)}`;
      log(detail);
      return { detail, warn: true };
    }
    log(`cloned node_modules from ${name}`);
    return { detail: `Cloned from ${name}, npm ci skipped` };
  }

  /** `apm install --target <t>` per target. A missing apm is a warning; a failing install fails the step. */
  private async installAgentPackages(
    plan: SetupPlan,
    log: (l: string) => void,
  ): Promise<{ detail: string; warn?: boolean }> {
    if (!(await exists(path.join(plan.worktreePath, 'apm.yml')))) {
      log('no apm.yml in the worktree');
      return { detail: 'No apm.yml in the worktree' };
    }
    try {
      await this.spawnLogged(
        this.platform.shellCommand('apm --version'),
        plan.worktreePath,
        () => {},
        'apm --version',
      );
    } catch {
      const detail = 'apm is not installed, skipped';
      log(`${detail} (see https://microsoft.github.io/apm/)`);
      return { detail, warn: true };
    }
    const targets = plan.apmTargets ?? [];
    for (const target of targets) {
      const cmd = `apm install --target ${target}`;
      log(`$ ${cmd}`);
      await this.spawnLogged(
        this.platform.shellCommand(cmd),
        plan.worktreePath,
        log,
        cmd,
      );
    }
    return { detail: `Installed for ${targets.join(', ')}` };
  }

  private spawnLogged(
    { command, args, env }: Command,
    cwd: string,
    log: (l: string) => void,
    cmd: string,
  ): Promise<void> {
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
