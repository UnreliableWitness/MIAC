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
  timeOverride = time,
}: {
  estimateHours?: number | null;
  initial?: number | null;
  onChange?: (s: number | null) => void;
  timeOverride?: typeof time;
}) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <TimeSpentSection
      task={task}
      time={timeOverride}
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

  it('snaps slider values to clock multiples of 5 minutes but keeps the exact ends', () => {
    const odd = { ...time, activeSeconds: 11237, wallClockSeconds: 34213 };
    const onChange = vi.fn();
    render(<Harness timeOverride={odd} initial={11237} onChange={onChange} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '20000' } });
    expect(onChange).toHaveBeenLastCalledWith(20100);
    fireEvent.change(slider, { target: { value: '34213' } });
    expect(onChange).toHaveBeenLastCalledWith(34213);
    fireEvent.change(slider, { target: { value: '11237' } });
    expect(onChange).toHaveBeenLastCalledWith(11237);
  });

  it('describes the slider value and links the error to the field', async () => {
    render(<Harness />);
    expect(screen.getByRole('slider')).toHaveAttribute(
      'aria-valuetext',
      '3h 10m',
    );
    const field = screen.getByLabelText('Time to book');
    await userEvent.clear(field);
    await userEvent.type(field, 'abc');
    const err = screen.getByText('Enter a time like 3h 30m or 3.5');
    expect(field.getAttribute('aria-describedby')).toBe(err.id);
    expect(err.id).not.toBe('');
  });

  it('treats an estimate of 0 hours as no estimate', () => {
    render(<Harness estimateHours={0} />);
    expect(screen.queryByText(/estimate/)).toBeNull();
  });

  it('combines marks with equal values into one labelled mark', () => {
    render(
      <Harness
        initial={60}
        timeOverride={{
          ...time,
          activeSeconds: 60,
          realisticSeconds: 60,
          wallClockSeconds: 3600,
        }}
      />,
    );
    expect(screen.getByText('measured · you + agents')).toBeInTheDocument();
    expect(screen.getAllByText('1m')).toHaveLength(1);
    expect(screen.getByText('wall clock (work hrs)')).toBeInTheDocument();
    expect(document.querySelectorAll('.time-mark')).toHaveLength(2);
  });

  it('shows a single mark when all three values are equal', () => {
    render(
      <Harness
        initial={60}
        timeOverride={{
          ...time,
          activeSeconds: 60,
          realisticSeconds: 60,
          wallClockSeconds: 60,
        }}
      />,
    );
    expect(document.querySelectorAll('.time-mark')).toHaveLength(1);
    expect(
      screen.getByText('measured · you + agents · wall clock (work hrs)'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Time to book slider')).toHaveAttribute(
      'aria-valuetext',
      '1m',
    );
  });

  it('left-aligns the mark at 0 percent and right-aligns the one at 100 percent', () => {
    render(<Harness />);
    const marks = document.querySelectorAll('.time-mark');
    expect(marks[0]).toHaveClass('edge-start');
    expect(marks[1]).not.toHaveClass('edge-start');
    expect(marks[1]).not.toHaveClass('edge-end');
    expect(marks[2]).toHaveClass('edge-end');
  });
});
