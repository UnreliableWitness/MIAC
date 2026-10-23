import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LeakNotice } from './LeakNotice';

const handlers = () => ({
  onResume: vi.fn(),
  onStop: vi.fn(),
  onOpenSecrets: vi.fn(),
});

describe('LeakNotice', () => {
  it('says plainly what Shellie hid and what it cannot undo', async () => {
    const h = handlers();
    render(
      <LeakNotice
        state={{ names: ['STRIPE_SECRET_KEY'], paused: false }}
        {...h}
      />,
    );
    const notice = screen.getByRole('status');
    expect(notice.textContent).toBe(
      'A secret value showed up in this tab. Shellie hid it on screen as [STRIPE_SECRET_KEY]. The model already read it in the response — rotate the key if this session leaves your machine.Open SecretsWhy this happens',
    );
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open Secrets' }));
    expect(h.onOpenSecrets).toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole('button', { name: 'Why this happens' }),
    );
    expect(screen.getByText(/after the model wrote it/)).toBeTruthy();
  });

  it('names every secret that showed up', () => {
    render(
      <LeakNotice
        state={{ names: ['A_KEY', 'B_KEY'], paused: false }}
        {...handlers()}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain(
      'Secret values showed up in this tab. Shellie hid them on screen as [A_KEY] and [B_KEY]. The model already read them in the response — rotate the keys if this session leaves your machine.',
    );
  });

  it('shows the Production bar with Resume and Stop while input is paused', async () => {
    const h = handlers();
    render(
      <LeakNotice state={{ names: ['DB_PASSWORD'], paused: true }} {...h} />,
    );
    const bar = screen.getByRole('alert');
    expect(bar.textContent).toContain('A Production secret appeared');
    expect(bar.textContent).toContain('rotate');
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(h.onResume).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(h.onStop).toHaveBeenCalled();
  });

  it('comes back after Dismiss when another name shows up', async () => {
    const h = handlers();
    const { rerender } = render(
      <LeakNotice state={{ names: ['A_KEY'], paused: false }} {...h} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
    act(() =>
      rerender(
        <LeakNotice
          state={{ names: ['A_KEY', 'B_KEY'], paused: false }}
          {...h}
        />,
      ),
    );
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows nothing without a leak', () => {
    const { container } = render(<LeakNotice state={null} {...handlers()} />);
    expect(container.innerHTML).toBe('');
  });
});
