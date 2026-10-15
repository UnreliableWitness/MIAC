import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Bracketed, IconButton, Label, MindMark, RingGauge } from '.';

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
          { value: 8, color: 'var(--accent)' },
          { value: 2, color: 'var(--blue)' },
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

describe('Bracketed, Label, MindMark', () => {
  it('marks the active frame', () => {
    const { container } = render(<Bracketed active>x</Bracketed>);
    expect(container.firstChild).toHaveClass('bracketed', 'is-active');
  });
  it('renders a label and a decorative mark', () => {
    const { container } = render(
      <>
        <Label>webshop</Label>
        <MindMark />
      </>,
    );
    expect(screen.getByText('webshop')).toHaveClass('ilabel');
    expect(container.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
