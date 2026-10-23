import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { TaskView } from '../../../shared/types';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { CleanWorktreeButton } from './CleanWorktreeButton';

const task = {
  id: 't1',
  repoId: 'r1',
  extraWorkspaces: [],
  homeDropped: false,
} as unknown as TaskView;
const dirty = {
  state: 'attention' as const,
  reasons: [{ kind: 'worktrees' as const, taskIds: ['t1'] }],
  given: [],
  secrets: 1,
};

describe('CleanWorktreeButton', () => {
  it('shows only when this task still has the old copy, and cleans just it', async () => {
    let state = dirty;
    const api = installFakeApi({
      'secrets:status': () => state,
      'secrets:cleanWorktrees': () => {
        state = { state: 'attention', reasons: [], given: [], secrets: 1 };
        return ['t1'];
      },
    });
    const user = userEvent.setup();
    render(<CleanWorktreeButton task={task} />);
    await user.click(
      await screen.findByRole('button', { name: 'Clean worktree' }),
    );
    expect(
      api.calls.find((c) => c.channel === 'secrets:cleanWorktrees')?.args,
    ).toEqual(['r1', 't1']);
    api.emit('secrets:changed', null);
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
  });

  it('renders nothing when another task is the dirty one', async () => {
    const api = installFakeApi({
      'secrets:status': () => ({
        ...dirty,
        reasons: [{ kind: 'worktrees', taskIds: ['other'] }],
      }),
    });
    render(<CleanWorktreeButton task={task} />);
    await waitFor(() =>
      expect(api.calls.some((c) => c.channel === 'secrets:status')).toBe(true),
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
