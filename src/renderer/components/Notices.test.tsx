import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { installFakeApi } from '../test-helpers/fakeApi';
import { Notices } from './Notices';

describe('update notice', () => {
  it('shows nothing until an update is ready, then offers Restart and update', async () => {
    const { emit, calls } = installFakeApi({
      'update:install': () => undefined,
    });
    render(<Notices />);
    await waitFor(() =>
      expect(calls.some((c) => c.channel === 'update:status')).toBe(true),
    );
    expect(screen.queryByText(/is ready/)).toBeNull();
    act(() => emit('update:ready', { version: '1.0.3' }));
    expect(screen.getByText('Shellie 1.0.3 is ready')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Restart and update' }),
    );
    expect(calls.some((c) => c.channel === 'update:install')).toBe(true);
  });

  it('shows an update that downloaded before the window opened', async () => {
    installFakeApi({ 'update:status': () => ({ version: null }) });
    render(<Notices />);
    expect(
      await screen.findByText('A new version of Shellie is ready'),
    ).toBeInTheDocument();
  });

  it('Later hides it without installing', async () => {
    const { calls } = installFakeApi({
      'update:status': () => ({ version: '1.0.3' }),
    });
    render(<Notices />);
    await userEvent.click(await screen.findByRole('button', { name: 'Later' }));
    expect(screen.queryByText('Shellie 1.0.3 is ready')).toBeNull();
    expect(calls.some((c) => c.channel === 'update:install')).toBe(false);
  });

  it('stays visible with a notice when the install fails', async () => {
    installFakeApi({
      'update:status': () => ({ version: '1.0.3' }),
      'update:install': () => {
        throw new Error('No update is ready to install');
      },
    });
    render(<Notices />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Restart and update' }),
    );
    expect(
      await screen.findByText('No update is ready to install'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Restart and update' }),
    ).toBeEnabled();
  });
});
