import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkItemSummary } from '../../shared/types';
import { useStore } from '../store';
import { installFakeApi } from '../test-helpers/fakeApi';
import { WorkItemPicker } from './WorkItemPicker';

const DOT = String.fromCharCode(0xb7);
const item = (id: string, title: string, type = 'Issue'): WorkItemSummary => ({
  id,
  type,
  title,
  state: 'To Do',
  areaPath: 'MIAC',
  iterationPath: 'MIAC\\Sprint 1',
  assignedTo: null,
  url: `https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/${id}`,
});

beforeEach(() => useStore.setState({ notices: [] }));

describe('WorkItemPicker', () => {
  it('searches the current sprint on open and lists results', async () => {
    const { calls } = installFakeApi({
      'workItems:currentIteration': () => ({
        path: 'MIAC\\Sprint 1',
        name: 'Sprint 1',
      }),
      'workItems:search': () => [
        item('12', 'Save address'),
        item('7', 'Tidy', 'Task'),
      ],
    });
    render(
      <WorkItemPicker connectionId="c1" selectedId={null} onPick={() => {}} />,
    );
    expect(await screen.findByText('Save address')).toBeInTheDocument();
    expect(screen.getByText(`12 ${DOT} To Do ${DOT} MIAC`)).toBeInTheDocument();
    expect(calls.find((c) => c.channel === 'workItems:search')?.args).toEqual([
      'c1',
      { scope: 'sprint', text: '' },
    ]);
    expect(
      screen.getByRole('button', { name: 'Current sprint' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches to assigned to me', async () => {
    const { calls } = installFakeApi({
      'workItems:currentIteration': () => ({ path: 'p', name: 'Sprint 1' }),
      'workItems:search': () => [],
    });
    render(
      <WorkItemPicker connectionId="c1" selectedId={null} onPick={() => {}} />,
    );
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'workItems:search')).toBe(true),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Assigned to me' }),
    );
    await waitFor(() =>
      expect(
        calls.filter((c) => c.channel === 'workItems:search').at(-1)?.args,
      ).toEqual(['c1', { scope: 'mine', text: '' }]),
    );
  });

  it('falls back to assigned to me when there is no current sprint', async () => {
    const { calls } = installFakeApi({
      'workItems:currentIteration': () => null,
      'workItems:search': () => [],
    });
    render(
      <WorkItemPicker connectionId="c1" selectedId={null} onPick={() => {}} />,
    );
    expect(await screen.findByText(/No current sprint/)).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.find((c) => c.channel === 'workItems:search')?.args).toEqual(
        ['c1', { scope: 'mine', text: '' }],
      ),
    );
    expect(
      screen.getByRole('button', { name: 'Current sprint' }),
    ).toBeDisabled();
  });

  it('debounces typed search text', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = installFakeApi({
      'workItems:currentIteration': () => ({ path: 'p', name: 'S' }),
      'workItems:search': () => [],
    });
    render(
      <WorkItemPicker connectionId="c1" selectedId={null} onPick={() => {}} />,
    );
    await userEvent.type(screen.getByLabelText('Search work items'), 'addr');
    await vi.advanceTimersByTimeAsync(350);
    await waitFor(() =>
      expect(
        calls.filter((c) => c.channel === 'workItems:search').at(-1)?.args,
      ).toEqual(['c1', { scope: 'sprint', text: 'addr' }]),
    );
    expect(
      calls.filter(
        (c) =>
          c.channel === 'workItems:search' &&
          (c.args[1] as { text: string }).text === 'a',
      ),
    ).toHaveLength(0);
    vi.useRealTimers();
  });

  it('picks an item', async () => {
    const onPick = vi.fn();
    installFakeApi({
      'workItems:currentIteration': () => ({ path: 'p', name: 'S' }),
      'workItems:search': () => [item('12', 'Save address')],
    });
    render(
      <WorkItemPicker connectionId="c1" selectedId={null} onPick={onPick} />,
    );
    await userEvent.click(
      await screen.findByRole('button', { name: /Save address/ }),
    );
    expect(onPick).toHaveBeenCalledWith({
      id: '12',
      type: 'Issue',
      title: 'Save address',
      url: 'https://dev.azure.com/unreliablewitness/MIAC/_workitems/edit/12',
    });
  });

  it('shows the error and an empty list when search fails', async () => {
    installFakeApi({
      'workItems:currentIteration': () => ({ path: 'p', name: 'S' }),
      'workItems:search': () => {
        throw new Error('Azure DevOps rejected the token');
      },
    });
    render(
      <WorkItemPicker connectionId="c1" selectedId={null} onPick={() => {}} />,
    );
    await waitFor(() =>
      expect(useStore.getState().notices[0]?.message).toMatch(
        /rejected the token/,
      ),
    );
    expect(screen.getByText(/Could not load work items/)).toBeInTheDocument();
  });
});
