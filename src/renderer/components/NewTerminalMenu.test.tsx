import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NewTerminalMenu } from './NewTerminalMenu';

describe('NewTerminalMenu with several repos', () => {
  it('asks for the repo after the terminal type', async () => {
    const onOpen = vi.fn();
    render(
      <NewTerminalMenu
        workspaces={[
          { id: 'home', name: 'webshop' },
          { id: 'w1', name: 'api' },
        ]}
        onOpen={onOpen}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'New terminal' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Shell' }));
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('menuitem', { name: 'api' }));
    expect(onOpen).toHaveBeenCalledWith({
      kind: 'shell',
      label: 'shell',
      workspaceId: 'w1',
    });
  });

  it('opens straight away with one repo', async () => {
    const onOpen = vi.fn();
    render(
      <NewTerminalMenu
        workspaces={[{ id: 'home', name: 'webshop' }]}
        onOpen={onOpen}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'New terminal' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Shell' }));
    expect(onOpen).toHaveBeenCalledWith({ kind: 'shell', label: 'shell' });
  });
});
