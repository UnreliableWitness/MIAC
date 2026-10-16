import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { emptyTime, installFakeApi } from '../test-helpers/fakeApi';
import { TimePanel } from './TimePanel';

beforeEach(() => {
  useStore.setState({
    notices: [],
    repos: [],
    tasks: [
      {
        id: 't1',
        slug: 'a',
        repoId: 'r1',
        workItem: { id: '1', type: 'Task', title: 'x', url: null },
      } as never,
    ],
  });
});

const time = {
  ...emptyTime('t1'),
  activeSeconds: 11400,
  realisticSeconds: 12000,
  wallClockSeconds: 20000,
  agentSeconds: { 'claude-code': 6000, 'copilot-cli': 0, opencode: 0 },
};

describe('TimePanel', () => {
  it('shows measured time and Claude time', async () => {
    installFakeApi({ 'time:task': () => time });
    render(<TimePanel taskId="t1" />);
    expect(screen.getByRole('heading', { name: 'Time' })).toBeInTheDocument();
    expect(await screen.findByText('3h 10m')).toBeInTheDocument();
    expect(screen.getByText('1h 40m')).toBeInTheDocument();
  });

  it('shows the booking and the estimate bar', async () => {
    installFakeApi({
      'time:task': () => ({
        ...time,
        estimate: { hours: 8, source: 'baseline' as const },
        booking: {
          bookedSeconds: 14400,
          measuredSeconds: 11400,
          realisticSeconds: 12000,
          wallClockSeconds: 20000,
          agentSeconds: time.agentSeconds,
          bookedAt: '2026-10-16T10:00:00Z',
          writtenHours: 0,
          syncError: null,
        },
      }),
    });
    render(<TimePanel taskId="t1" />);
    expect(await screen.findByText(/4h of 8h estimate/)).toBeInTheDocument();
    expect(screen.getByText('booked')).toBeInTheDocument();
  });

  it('exports the time as CSV', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      () => undefined,
    );
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const { calls } = installFakeApi({
      'time:task': () => time,
      'time:exportCsv': () => 'task\r\n',
    });
    render(<TimePanel taskId="t1" />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Export time (CSV)' }),
    );
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(calls.find((c) => c.channel === 'time:exportCsv')?.args).toEqual([
      't1',
    ]);
  });
});
