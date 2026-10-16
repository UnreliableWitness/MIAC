import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SetupState } from '../../shared/types';
import { StepList } from './StepList';

describe('StepList', () => {
  it('renders a ticked rule with status per step', () => {
    const steps: SetupState['steps'] = [
      {
        def: { kind: 'worktree', label: 'Create worktree', detail: '' },
        status: 'done',
        ms: 1200,
      },
      {
        def: { kind: 'apm', label: 'npm ci', detail: '' },
        status: 'running',
      },
      {
        def: { kind: 'apm', label: 'Build', detail: '' },
        status: 'failed',
      },
    ];
    render(<StepList steps={steps} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => i.getAttribute('data-status'))).toEqual([
      'done',
      'running',
      'failed',
    ]);
    expect(screen.getByRole('list')).toHaveClass('steps', 'steps-rule');
  });

  it('renders a warn step with the warn icon', () => {
    render(
      <StepList
        steps={[
          {
            def: { kind: 'work-item', label: 'Update work item', detail: '' },
            status: 'warn',
            detail: 'Could not update the work item',
          },
        ]}
      />,
    );
    const item = screen.getByRole('listitem');
    expect(item).toHaveAttribute('data-status', 'warn');
    expect(item.querySelector('.step-icon')).toHaveTextContent(
      String.fromCharCode(0x26a0),
    );
  });
});
