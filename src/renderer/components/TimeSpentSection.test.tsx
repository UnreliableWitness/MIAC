import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { TaskView } from '../../shared/types';
import { emptyTime } from '../test-helpers/fakeApi';
import { TimeSpentSection } from './TimeSpentSection';

const task = {
  id: 'a',
  createdAt: '2026-10-13T09:12:00.000Z',
} as TaskView;
const time = {
  ...emptyTime('a'),
  activeSeconds: 11400,
  realisticSeconds: 14700,
  wallClockSeconds: 34200,
  agentSeconds: { 'claude-code': 6000, 'copilot-cli': 720, opencode: 300 },
};

function Harness({
  estimateHours = null,
  initial = 11400,
  onChange = () => undefined,
}: {
  estimateHours?: number | null;
  initial?: number | null;
  onChange?: (s: number | null) => void;
}) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <TimeSpentSection
      task={task}
      time={time}
      estimateHours={estimateHours}
      value={v}
      onChange={(s) => {
        setV(s);
        onChange(s);
      }}
    />
  );
}

describe('TimeSpentSection', () => {
  it('shows the three marks and starts at measured time', () => {
    render(<Harness />);
    expect(screen.getByText('measured')).toBeInTheDocument();
    expect(screen.getByText('you + agents')).toBeInTheDocument();
    expect(screen.getByText('wall clock (work hrs)')).toBeInTheDocument();
    expect(screen.getAllByText('3h 10m').length).toBeGreaterThan(0);
    expect(screen.getByText('4h 5m')).toBeInTheDocument();
    expect(screen.getByText('9h 30m')).toBeInTheDocument();
    expect(screen.getByLabelText('Time to book')).toHaveValue('3h 10m');
  });

  it('moving the slider fills the field and reports the seconds', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByRole('slider'), {
      target: { value: '14700' },
    });
    expect(screen.getByLabelText('Time to book')).toHaveValue('4h 5m');
    expect(onChange).toHaveBeenCalledWith(14700);
  });

  it('typing a time reports it, and an invalid one reports null with an error', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const field = screen.getByLabelText('Time to book');
    await userEvent.clear(field);
    await userEvent.type(field, '3.5');
    expect(onChange).toHaveBeenLastCalledWith(12600);
    await userEvent.clear(field);
    await userEvent.type(field, 'abc');
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(
      screen.getByText('Enter a time like 3h 30m or 3.5'),
    ).toBeInTheDocument();
  });

  it('shows the estimate and turns the bar amber above 100 percent', async () => {
    render(<Harness estimateHours={5} />);
    expect(screen.getByText('3h 10m of 5h estimate')).toBeInTheDocument();
    expect(screen.getByTestId('time-bar')).not.toHaveClass('over');
    const field = screen.getByLabelText('Time to book');
    await userEvent.clear(field);
    await userEvent.type(field, '6h');
    expect(screen.getByText('6h of 5h estimate')).toBeInTheDocument();
    expect(screen.getByTestId('time-bar')).toHaveClass('over');
  });

  it('lists agent time per tool, OpenCode as an estimate', () => {
    render(<Harness />);
    expect(screen.getByText('1h 40m')).toBeInTheDocument();
    expect(screen.getByText(/Claude Code/)).toBeInTheDocument();
    expect(screen.getByText('12m')).toBeInTheDocument();
    expect(screen.getByText(/OpenCode est\./)).toBeInTheDocument();
  });

  it('shows no estimate line without an estimate', () => {
    render(<Harness estimateHours={null} />);
    expect(screen.queryByText(/estimate/)).toBeNull();
  });
});
