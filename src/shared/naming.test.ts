import { describe, expect, it } from 'vitest';
import {
  branchType,
  claudePrompt,
  renderBranch,
  renderTaskMd,
  slugify,
  taskSlug,
} from './naming';
import type { Task } from './types';

const story = {
  id: '48231',
  type: 'User Story' as const,
  title: 'Show estimated delivery date on product page',
};
const bug = {
  id: '48227',
  type: 'Bug' as const,
  title: 'Coupon code field ignores trailing spaces',
};

describe('slugify', () => {
  it('lowercases and joins words with dashes', () => {
    expect(slugify('Show estimated delivery date')).toBe(
      'show-estimated-delivery-date',
    );
  });
  it('strips accents, emoji and punctuation', () => {
    expect(slugify('Café résumé 🚀 (v2)!')).toBe('cafe-resume-v2');
  });
  it('caps at 40 characters without a trailing dash', () => {
    const s = slugify(
      'This is a very long work item title that keeps going and going forever',
    );
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith('-')).toBe(false);
    expect(s).toBe('this-is-a-very-long-work-item-title-that');
  });
  it('returns "task" for an empty result', () => {
    expect(slugify('!!!')).toBe('task');
  });
});

describe('branchType', () => {
  it('is bugfix for bugs and feature otherwise', () => {
    expect(branchType(bug)).toBe('bugfix');
    expect(branchType(story)).toBe('feature');
    expect(branchType({ ...story, type: 'Task' })).toBe('feature');
    expect(branchType(null)).toBe('feature');
  });
});

describe('renderBranch', () => {
  const tpl = '{type}/{id}-{slug}';
  it('renders a work item', () => {
    expect(renderBranch(tpl, { workItem: story, name: '' })).toBe(
      'feature/48231-show-estimated-delivery-date-on-product',
    );
    expect(renderBranch(tpl, { workItem: bug, name: '' })).toBe(
      'bugfix/48227-coupon-code-field-ignores-trailing-space',
    );
  });
  it('drops the id segment for a blank task', () => {
    expect(
      renderBranch(tpl, { workItem: null, name: 'spike new search' }),
    ).toBe('feature/spike-new-search');
  });
  it('supports templates without a type', () => {
    expect(
      renderBranch('users/dries/{id}-{slug}', { workItem: story, name: '' }),
    ).toBe('users/dries/48231-show-estimated-delivery-date-on-product');
  });
});

describe('taskSlug', () => {
  it('prefixes the id when there is a work item', () => {
    expect(taskSlug(story, '')).toBe(
      '48231-show-estimated-delivery-date-on-product',
    );
    expect(taskSlug(null, 'Spike: new search')).toBe('spike-new-search');
  });
});

const task: Task = {
  id: 't1',
  repoId: 'r1',
  name: '',
  workItem: story,
  slug: '48231-show-estimated-delivery-date-on',
  branch: 'feature/48231-show-estimated-delivery-date-on',
  worktreePath: '/src/webshop.worktrees/48231-show-estimated-delivery-date-on',
  baseRef: 'origin/main',
  status: 'ready',
  setup: {
    copy: true,
    commands: ['npm ci'],
    startClaude: true,
    openShell: true,
  },
  terminals: [],
  createdAt: '2026-10-14T09:00:00.000Z',
  finishedAt: null,
};

describe('renderTaskMd', () => {
  it('lists the work item, branch and worktree', () => {
    const md = renderTaskMd(task);
    expect(md).toContain(
      '# User Story 48231: Show estimated delivery date on product page',
    );
    expect(md).toContain(
      '- Branch: `feature/48231-show-estimated-delivery-date-on`',
    );
    expect(md).toContain(
      '- Worktree: `/src/webshop.worktrees/48231-show-estimated-delivery-date-on`',
    );
  });
  it('uses the task name for blank tasks', () => {
    expect(
      renderTaskMd({ ...task, workItem: null, name: 'Spike new search' }),
    ).toContain('# Task: Spike new search');
  });
});

describe('claudePrompt', () => {
  it('names the work item and points at the task file', () => {
    expect(claudePrompt(task)).toBe(
      'Work item 48231: Show estimated delivery date on product page. Details are in .miac/task.md.',
    );
    expect(claudePrompt({ ...task, workItem: null, name: 'Spike' })).toBe(
      'Task: Spike. Details are in .miac/task.md.',
    );
  });
});
