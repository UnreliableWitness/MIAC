import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { PendingRun } from '../../../shared/secrets';
import { installFakeApi } from '../../test-helpers/fakeApi';
import { RunApproveBar } from './RunApproveBar';

const run = (over: Partial<PendingRun> = {}): PendingRun => ({
  id: 'r1',
  taskId: 't1',
  name: 'test',
  command: 'npm test',
  args: ['--watch=false', 'src/a b.test.ts'],
  environment: 'production',
  ...over,
});

describe('RunApproveBar', () => {
  it('shows nothing while no run waits', async () => {
    const { calls } = installFakeApi();
    const { container } = render(<RunApproveBar taskId="t1" />);
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'runs:pending')).toBe(true),
    );
    expect(container.innerHTML).toBe('');
  });

  it("shows this task's waiting run: name, command, arguments and environment", async () => {
    installFakeApi({
      'runs:pending': () => [run(), run({ id: 'r2', taskId: 'other' })],
    });
    render(<RunApproveBar taskId="t1" />);
    const bar = await screen.findByRole('alert');
    expect(bar).toHaveClass('run-approve', 'run-approve-production');
    expect(bar).toHaveTextContent(
      'An agent asks to run test with Production secrets',
    );
    expect(
      within(bar).getByText('npm test --watch=false "src/a b.test.ts"'),
    ).toBeTruthy();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('shows the script npm test really runs and that the worktree can change it', async () => {
    installFakeApi({
      'runs:pending': () => [
        run({
          scripts: [
            { name: 'pretest', text: 'node pre.js' },
            { name: 'test', text: 'vitest run' },
            { name: 'posttest', text: 'echo done' },
          ],
          args: ['--', '--watch=false'],
        }),
      ],
    });
    render(<RunApproveBar taskId="t1" />);
    const bar = await screen.findByRole('alert');
    expect(within(bar).getByText('npm test -- --watch=false')).toBeTruthy();
    expect(within(bar).getByText('pretest: node pre.js')).toBeTruthy();
    expect(within(bar).getByText('test: vitest run')).toBeTruthy();
    expect(within(bar).getByText('posttest: echo done')).toBeTruthy();
    expect(bar).toHaveTextContent('runs the scripts');
    expect(bar).toHaveTextContent(
      'Files in this worktree changed since the base can change what this runs.',
    );
  });

  it('marks bidi override and isolate characters in what it shows', async () => {
    installFakeApi({
      'runs:pending': () => [
        run({
          command: 'npm run a\u202e',
          scripts: [{ name: 'a', text: 'echo ok \u2066# hidden\u2069' }],
          args: [],
        }),
      ],
    });
    render(<RunApproveBar taskId="t1" />);
    const bar = await screen.findByRole('alert');
    expect(bar.textContent).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/);
    expect(within(bar).getByText('npm run a<U+202E>')).toBeTruthy();
    expect(
      within(bar).getByText('a: echo ok <U+2066># hidden<U+2069>'),
    ).toBeTruthy();
  });

  it('shows the full command of a run: entry', async () => {
    installFakeApi({
      'runs:pending': () => [
        run({ name: 'seed', command: 'node tools/seed.mjs --all', args: [] }),
      ],
    });
    render(<RunApproveBar taskId="t1" />);
    const bar = await screen.findByRole('alert');
    expect(within(bar).getByText('node tools/seed.mjs --all')).toBeTruthy();
    expect(bar).not.toHaveTextContent('runs the scripts');
  });

  it('approves or refuses through main', async () => {
    const { calls } = installFakeApi({
      'runs:pending': () => [run(), run({ id: 'r2', environment: 'uat' })],
      'runs:approve': () => undefined,
    });
    render(<RunApproveBar taskId="t1" />);
    const [first, second] = await screen.findAllByRole('alert');
    expect(second).toHaveTextContent('with UAT secrets');
    await userEvent.click(
      within(first!).getByRole('button', { name: 'Approve' }),
    );
    await userEvent.click(
      within(second!).getByRole('button', { name: 'Refuse' }),
    );
    expect(calls.filter((c) => c.channel === 'runs:approve')).toEqual([
      { channel: 'runs:approve', args: ['r1', true] },
      { channel: 'runs:approve', args: ['r2', false] },
    ]);
  });

  it('follows runs:pending events', async () => {
    const { emit, calls } = installFakeApi();
    render(<RunApproveBar taskId="t1" />);
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'runs:pending')).toBe(true),
    );
    act(() => emit('runs:pending', [run()]));
    expect(await screen.findByRole('alert')).toBeTruthy();
    act(() => emit('runs:pending', []));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
