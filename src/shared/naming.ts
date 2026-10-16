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

const folderWorktrees = (task: Pick<Task, 'folder' | 'worktrees'>) =>
  typeof task.folder === 'string' && task.folder.length > 0
    ? (task.worktrees ?? [])
    : null;

export function renderTaskMd(task: Task): string {
  const repos = folderWorktrees(task);
  if (repos) {
    return [
      `# ${taskTitle(task)}`,
      '',
      `- Branch: \`${task.branch}\``,
      `- Folder: \`${task.folder}\``,
      `- Created: ${task.createdAt}`,
      `- Repos: ${repos.map((w) => `\`${w.dir}/\` from \`${w.baseRef}\``).join(', ')} (CLAUDE.md has the current list)`,
      '',
      'This file is written once by MIAC and kept when repos are added or removed. Put notes for the task here.',
      '',
    ].join('\n');
  }
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

/** Appended to Claude Code's system prompt: the task, and that Claude waits for the user before working on it. */
export function claudeContext(
  task: Pick<Task, 'workItem' | 'name'> &
    Partial<Pick<Task, 'folder' | 'worktrees' | 'branch'>>,
): string {
  const head = task.workItem
    ? `${task.workItem.type} ${task.workItem.id}: ${task.workItem.title}`
    : `Task: ${task.name}`;
  const repos = folderWorktrees(task);
  if (repos)
    return `This folder is a MIAC task for ${head}. Each of its folders ${repos.map((w) => `${w.dir}/`).join(', ')} is a worktree of one repo, on branch ${task.branch}. Make each change in the repo it belongs to and run git inside that repo's folder. The details are in CLAUDE.md and .miac/task.md. Do not start on the task by yourself: wait for the user's instructions.`;
  return `This folder is a MIAC task for ${head}. The details are in .miac/task.md. Do not start on the task by yourself: wait for the user's instructions.`;
}

/**
 * The CLAUDE.md of a task folder: the repos and their folders, and imports of each repo's own CLAUDE.md so
 * Claude, started in the task folder, still follows them.
 */
export function renderClaudeMd(
  task: Task,
  repos: { dir: string; name: string; hasClaudeMd: boolean }[],
): string {
  const base = new Map(
    (task.worktrees ?? []).map((w) => [w.dir, w.baseRef] as const),
  );
  const imports = repos
    .filter((r) => r.hasClaudeMd)
    .map((r) => `@${r.dir}/CLAUDE.md`);
  return [
    `# MIAC task: ${taskTitle(task).replace(/^Task: /, '')}`,
    '',
    `This folder is a MIAC task. Each folder below is a worktree of one repo, all on branch \`${task.branch}\`:`,
    '',
    ...repos.map(
      (r) =>
        `- \`${r.dir}/\`: repo ${r.name}, from \`${base.get(r.dir) ?? task.baseRef}\``,
    ),
    '',
    "Make each change in the repo it belongs to, and run git inside that repo's folder. Task notes: .miac/task.md.",
    '',
    'This file is written by MIAC and rewritten when a repo is added or removed.',
    '',
    ...(imports.length > 0 ? [...imports, ''] : []),
  ].join('\n');
}
