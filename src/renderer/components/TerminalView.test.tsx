import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installFakeApi } from '../test-helpers/fakeApi';
import { TerminalView } from './TerminalView';

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown> = {};
    modes = {};
    loadAddon() {}
    cols = 80;
    rows = 24;
    open() {}
    write() {}
    reset() {}
    focus() {}
    paste() {}
    attachCustomKeyEventHandler() {}
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
  followColorScheme: () => () => undefined,
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

describe('TerminalView sizing', () => {
  const resizes = (calls: { channel: string }[]) =>
    calls.filter((c) => c.channel === 'terminals:resize').length;
  const running = () =>
    installFakeApi({
      'terminals:buffer': () => '',
      'terminals:isRunning': () => true,
      'terminals:resize': () => undefined,
    });

  it('does not size the pty while the terminal is hidden (#70)', async () => {
    const { calls } = running();
    // jsdom has no layout: every box is 0 x 0, like a display:none one.
    render(<TerminalView terminalId="t1" taskId="a" active={false} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(resizes(calls)).toBe(0);
  });

  it('sizes the pty once the terminal has a box', async () => {
    const { calls } = running();
    const width = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(800);
    const height = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(600);
    try {
      render(<TerminalView terminalId="t1" taskId="a" active />);
      await waitFor(() => expect(resizes(calls)).toBeGreaterThan(0));
    } finally {
      width.mockRestore();
      height.mockRestore();
    }
  });
});
