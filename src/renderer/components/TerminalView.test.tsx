import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installFakeApi } from '../test-helpers/fakeApi';
import { TerminalView } from './TerminalView';

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown> = {};
    modes = {};
    loadAddon() {}
    open() {}
    write() {}
    reset() {}
    focus() {}
    paste() {}
    dispose() {}
    onData() {
      return { dispose() {} };
    }
    registerLinkProvider() {
      return { dispose() {} };
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock('../terminalSetup', () => ({
  loadRenderer: () => undefined,
  terminalOptions: () => ({}),
  windowsBuild: async () => null,
}));

class NoResize {
  observe() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoResize as never;

/** A terminal main does not know: the app was relaunched since it started. */
const relaunched = () =>
  installFakeApi({
    'terminals:buffer': () => {
      throw new Error('Unknown terminal t1');
    },
    'terminals:isRunning': () => false,
    'terminals:restart': () => undefined,
  });

const restarts = (calls: { channel: string }[]) =>
  calls.filter((c) => c.channel === 'terminals:restart').length;

describe('TerminalView after an app relaunch', () => {
  it('starts an autoStart terminal again when it is shown', async () => {
    const { calls } = relaunched();
    const { rerender } = render(
      <TerminalView terminalId="t1" taskId="a" active={false} autoStart />,
    );
    expect(await screen.findByText('Process ended')).toBeInTheDocument();
    expect(restarts(calls)).toBe(0);
    rerender(<TerminalView terminalId="t1" taskId="a" active autoStart />);
    await waitFor(() => expect(restarts(calls)).toBe(1));
    expect(screen.queryByText('Process ended')).not.toBeInTheDocument();
  });

  it('leaves other terminals for the user to restart', async () => {
    const { calls } = relaunched();
    render(<TerminalView terminalId="t1" taskId="a" active />);
    expect(
      await screen.findByRole('button', { name: 'Restart' }),
    ).toBeInTheDocument();
    expect(restarts(calls)).toBe(0);
  });

  it('does not restart a terminal whose process exited in this run', async () => {
    const { calls } = installFakeApi({
      'terminals:buffer': () => 'bye',
      'terminals:isRunning': () => false,
      'terminals:restart': () => undefined,
    });
    render(
      <TerminalView terminalId="t1" taskId="a" active autoStart resumes />,
    );
    expect(
      await screen.findByRole('button', { name: 'Resume session' }),
    ).toBeInTheDocument();
    expect(restarts(calls)).toBe(0);
  });
});
