import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  IconButton,
  MindMark,
  PageHeader,
  Pivots,
  RingGauge,
  StateDot,
  WorkItemTypeIcon,
} from '.';

const arcLength = (el: Element) =>
  Number(el.querySelector('[data-part="arc"]')!.getAttribute('data-fraction'));

describe('RingGauge', () => {
  it('fills against the 50 EUR reference scale without max', () => {
    render(<RingGauge value={12.5} label="AI cost 12.50" />);
    expect(arcLength(screen.getByRole('img', { name: 'AI cost 12.50' }))).toBe(
      0.25,
    );
  });
  it('clamps to the full ring and to empty', () => {
    const { container, rerender } = render(<RingGauge value={500} />);
    expect(arcLength(container)).toBe(1);
    rerender(<RingGauge value={-3} />);
    expect(arcLength(container)).toBe(0);
  });
  it('draws one arc per segment, in order', () => {
    const { container } = render(
      <RingGauge
        value={10}
        max={10}
        segments={[
          { value: 8, color: 'var(--chart-claude)' },
          { value: 2, color: 'var(--chart-copilot)' },
        ]}
      />,
    );
    const segs = container.querySelectorAll('[data-part="segment"]');
    expect([...segs].map((s) => s.getAttribute('data-fraction'))).toEqual([
      '0.8',
      '0.2',
    ]);
  });
  it('is hidden from assistive tech without a label', () => {
    const { container } = render(<RingGauge value={1} />);
    expect(container.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});

describe('IconButton', () => {
  it('uses the label as accessible name and the shortcut in the tooltip', async () => {
    const onClick = vi.fn();
    render(
      <IconButton label="New task" shortcut="Ctrl+N" onClick={onClick}>
        +
      </IconButton>,
    );
    const b = screen.getByRole('button', { name: 'New task' });
    expect(b).toHaveAttribute('title', 'New task (Ctrl+N)');
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('WorkItemTypeIcon', () => {
  it('falls back to a square in the ADO type color', () => {
    const { container } = render(
      <>
        <WorkItemTypeIcon type="Bug" />
        <WorkItemTypeIcon type="Product Backlog Item" />
        <WorkItemTypeIcon type="Something else" />
      </>,
    );
    const fills = [...container.querySelectorAll('.wit-fallback > span')].map(
      (s) => (s as HTMLElement).style.background,
    );
    expect(fills).toEqual([
      'rgb(204, 41, 61)',
      'rgb(0, 156, 204)',
      'rgb(136, 136, 136)',
    ]);
    expect(screen.getByRole('img', { name: 'Bug' })).toBeInTheDocument();
  });
  it('shows the real icon when given one', () => {
    render(<WorkItemTypeIcon type="Task" iconUrl="data:image/svg+xml,x" />);
    expect(screen.getByRole('img', { name: 'Task' })).toHaveAttribute(
      'src',
      'data:image/svg+xml,x',
    );
  });
});

describe('StateDot', () => {
  it('draws the state color before the name, with a fallback map', () => {
    const { container, rerender } = render(<StateDot state="Active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
    const dot = () => container.querySelector('.state-dot') as HTMLElement;
    expect(dot().style.background).toBe('rgb(0, 122, 204)');
    rerender(<StateDot state="Closed" />);
    expect(dot().style.background).toBe('rgb(51, 153, 51)');
    rerender(<StateDot state="Doing" color="#123456" />);
    expect(dot().style.background).toBe('rgb(18, 52, 86)');
  });
});

describe('PageHeader and Pivots', () => {
  it('renders the title and selects pivots', async () => {
    const onSelect = vi.fn();
    render(
      <PageHeader
        title="New task"
        pivots={
          <Pivots
            label="Start from"
            items={[
              { key: 'a', label: 'Work item' },
              { key: 'b', label: 'Typed' },
            ]}
            selected="a"
            onSelect={onSelect}
          />
        }
      />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'New task' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Work item' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Typed' }));
    expect(onSelect).toHaveBeenCalledWith('b');
  });
});

describe('MindMark', () => {
  it('is decorative', () => {
    const { container } = render(<MindMark />);
    expect(container.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
