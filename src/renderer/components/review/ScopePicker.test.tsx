import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewRepo } from '../../../shared/review';
import { ScopePicker } from './ScopePicker';

const sha = (c: string) => c.repeat(40);
const repo: ReviewRepo = {
  workspaceId: 'home',
  name: 'web',
  base: sha('b'),
  collapse: [],
  files: [],
  commits: [
    { sha: sha('c'), subject: 'second', author: 'Dev', date: '' },
    { sha: sha('d'), subject: 'first', author: 'Dev', date: '' },
  ],
};

describe('ScopePicker', () => {
  it('makes a range with Shift', () => {
    const onChange = vi.fn();
    render(
      <ScopePicker
        scope={{
          kind: 'commits',
          workspaceId: 'home',
          from: sha('d'),
          to: sha('d'),
        }}
        repos={[repo]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Commits' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /second/ }), {
      shiftKey: true,
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'commits',
      workspaceId: 'home',
      from: sha('d'),
      to: sha('c'),
    });
  });

  it('picks one commit on Shift when the current range is no longer listed', () => {
    const onChange = vi.fn();
    render(
      <ScopePicker
        scope={{
          kind: 'commits',
          workspaceId: 'home',
          from: sha('e'),
          to: sha('e'),
        }}
        repos={[repo]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Commits' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /second/ }), {
      shiftKey: true,
    });
    expect(onChange).toHaveBeenCalledWith({
      kind: 'commits',
      workspaceId: 'home',
      from: sha('c'),
      to: sha('c'),
    });
  });
});
