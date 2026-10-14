import type { Task, WorkItemRef } from './types';

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

export function renderTaskMd(task: Task): string {
  const lines = [
    `# ${taskTitle(task)}`,
    '',
    `- Branch: \`${task.branch}\``,
    `- Base: \`${task.baseRef}\``,
    `- Worktree: \`${task.worktreePath}\``,
    `- Created: ${task.createdAt}`,
    '',
    'This file is written by MIAC and excluded from git. Put notes for the task here.',
    '',
  ];
  return lines.join('\n');
}

export function claudePrompt(task: Pick<Task, 'workItem' | 'name'>): string {
  const head = task.workItem
    ? `Work item ${task.workItem.id}: ${task.workItem.title}`
    : `Task: ${task.name}`;
  return `${head}. Details are in .miac/task.md.`;
}
