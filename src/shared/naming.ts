import type { Task, WorkItemRef } from './types';
import { taskWorkspaces } from './workspaces';

export function slugify(text: string, max = 40): string {
  const base = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = base.slice(0, max).replace(/-+$/g, '');
  return cut || 'task';
}

export function branchType(workItem: WorkItemRef | null): 'feature' | 'bugfix' {
  return workItem?.type === 'Bug' ? 'bugfix' : 'feature';
}

export function renderBranch(
  template: string,
  input: { workItem: WorkItemRef | null; name: string },
): string {
  const slug = slugify(input.workItem?.title ?? input.name);
  let out = template
    .replaceAll('{type}', branchType(input.workItem))
    .replaceAll('{slug}', slug);
  const id = input.workItem?.id ?? '';
  out = id
    ? out.replaceAll('{id}', id)
    : out.replaceAll('{id}-', '').replaceAll('{id}', '');
  return out;
}

export function taskSlug(workItem: WorkItemRef | null, name: string): string {
  return workItem ? `${workItem.id}-${slugify(workItem.title)}` : slugify(name);
}

export function taskTitle(task: Pick<Task, 'workItem' | 'name'>): string {
  return task.workItem
    ? `${task.workItem.type} ${task.workItem.id}: ${task.workItem.title}`
    : `Task: ${task.name}`;
}

export function renderTaskMd(
  task: Task,
  repoPaths: Record<string, string> = {},
): string {
  const lines = [
    `# ${taskTitle(task)}`,
    '',
    `- Branch: \`${task.branch}\``,
    `- Base: \`${task.baseRef}\``,
    `- Worktree: \`${task.worktreePath}\``,
    `- Created: ${task.createdAt}`,
    '',
    ...(task.extraWorkspaces.length > 0
      ? [
          '## Workspaces',
          '',
          ...taskWorkspaces(task).map(
            (w) =>
              `- Repo \`${repoPaths[w.repoId] ?? w.repoId}\`: branch \`${w.branch}\`, worktree \`${w.worktreePath}\`${w.dropped ? ' (left out)' : ''}`,
          ),
          '',
        ]
      : []),
    otherReposInstruction(task),
    '',
    'This file is written by Shellie and excluded from git. Put notes for the task here.',
    '',
  ];
  return lines.join('\n');
}

/** How Claude joins another repo to the task: a worktree on the task's branch, which Shellie detects. */
export function otherReposInstruction(
  task: Pick<Task, 'branch' | 'slug'>,
): string {
  return `If this task needs changes in another repository, do not edit that repository's main checkout. Create a worktree there on this task's branch: git -C <repo> worktree add <repo>.worktrees/${task.slug} -b ${task.branch} <base> (use the repo's default branch as base, from origin when it exists). Shellie picks it up automatically.`;
}

/**
 * Tells an agent which commands get the project's secrets (`shellie run`); `names` are the task's run names.
 * Only for a repo with stored secrets.
 */
export function shellieRunInstruction(names: string[]): string {
  return `Commands that need this project's secrets (tests, the dev server) run through \`shellie run <name>\`; available: ${names.join(', ')}. Plain commands in your shell run without secrets.`;
}

/**
 * Appended to Claude Code's system prompt: the task, and that Claude waits for the user before working on it.
 * `runNames`: the `shellie run` names, given only when the task's repo has a stored secret.
 */
export function claudeContext(
  task: Pick<Task, 'workItem' | 'name' | 'branch' | 'slug'>,
  runNames?: string[],
): string {
  const base = `This folder is a Shellie task for ${taskTitle(task)}. The details are in .shellie/task.md. Do not start on the task by yourself: wait for the user's instructions. ${otherReposInstruction(task)}`;
  return runNames && runNames.length > 0
    ? `${base} ${shellieRunInstruction(runNames)}`
    : base;
}
