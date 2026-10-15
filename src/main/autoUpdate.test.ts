import { describe, expect, it, vi } from 'vitest';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  canAutoUpdate,
  startAutoUpdate,
  updateFeedUrl,
  type AutoUpdateDeps,
  type Timers,
} from './autoUpdate';

function fakeTimers() {
  const timeouts = new Map<number, { fn: () => void; ms: number }>();
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  let seq = 0;
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      timeouts.set(++seq, { fn, ms });
      return seq;
    },
    clearTimeout: (h) => void timeouts.delete(h as number),
    setInterval: (fn, ms) => {
      intervals.set(++seq, { fn, ms });
      return seq;
    },
    clearInterval: (h) => void intervals.delete(h as number),
  };
  return { timers, timeouts, intervals };
}

function setup(over: Partial<AutoUpdateDeps> = {}) {
  const listeners = new Map<string, (...a: unknown[]) => void>();
  const updater = {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, fn: (...a: unknown[]) => void) => {
      listeners.set(event, fn);
    }),
  };
  const t = fakeTimers();
  const deps: AutoUpdateDeps = {
    isPackaged: true,
    platform: 'win32',
    arch: 'x64',
    version: '1.2.3',
    argv: ['MIAC.exe'],
    enabled: undefined,
    updater,
    notify: vi.fn(),
    confirmRestart: vi.fn(async () => false),
    log: vi.fn(),
    timers: t.timers,
    ...over,
  };
  const handle = startAutoUpdate(deps);
  const emit = (event: string, ...args: unknown[]) =>
    listeners.get(event)?.(...args);
  return { deps, updater, handle, emit, ...t };
}

describe('updateFeedUrl', () => {
  it('points at update.electronjs.org for this repo, platform-arch and version', () => {
    expect(updateFeedUrl('win32', 'x64', '1.2.3')).toBe(
      'https://update.electronjs.org/UnreliableWitness/MIAC/win32-x64/1.2.3',
    );
  });
});

describe('canAutoUpdate', () => {
  it('is on only for packaged Windows builds that did not turn it off', () => {
    const base = { isPackaged: true, platform: 'win32' as const };
    expect(canAutoUpdate({ ...base, enabled: undefined })).toBe(true);
    expect(canAutoUpdate({ ...base, enabled: true })).toBe(true);
    expect(canAutoUpdate({ ...base, enabled: false })).toBe(false);
    expect(
      canAutoUpdate({ ...base, isPackaged: false, enabled: undefined }),
    ).toBe(false);
    expect(
      canAutoUpdate({ ...base, platform: 'darwin', enabled: undefined }),
    ).toBe(false);
  });
});

describe('startAutoUpdate', () => {
  it('does nothing in dev, on macOS or when turned off', () => {
    for (const over of [
      { isPackaged: false },
      { platform: 'darwin' as const },
      { enabled: false },
    ]) {
      const { handle, updater, timeouts, intervals } = setup(over);
      expect(handle).toBeNull();
      expect(updater.setFeedURL).not.toHaveBeenCalled();
      expect(timeouts.size + intervals.size).toBe(0);
    }
  });

  it('sets the feed, checks after a short delay and then hourly', () => {
    const { updater, timeouts, intervals } = setup();
    expect(updater.setFeedURL).toHaveBeenCalledWith({
      url: 'https://update.electronjs.org/UnreliableWitness/MIAC/win32-x64/1.2.3',
    });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    const [first] = [...timeouts.values()];
    expect(first.ms).toBe(FIRST_CHECK_DELAY_MS);
    first.fn();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    const [hourly] = [...intervals.values()];
    expect(hourly.ms).toBe(CHECK_INTERVAL_MS);
    hourly.fn();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('skips the start-up check on a Squirrel first run but keeps the hourly one', () => {
    const { timeouts, intervals } = setup({
      argv: ['MIAC.exe', '--squirrel-firstrun'],
    });
    expect(timeouts.size).toBe(0);
    expect(intervals.size).toBe(1);
  });

  it('logs check errors without a notice', () => {
    const { emit, deps, updater, timeouts } = setup();
    emit('error', new Error('offline'));
    updater.checkForUpdates.mockImplementation(() => {
      throw new Error('not installed by Squirrel');
    });
    [...timeouts.values()][0].fn();
    expect(deps.log).toHaveBeenCalledTimes(2);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('on download: shows a notice, stops checking and leaves the install to the next start', async () => {
    const { emit, deps, updater, timeouts, intervals } = setup();
    emit('update-downloaded', {}, '', 'MIAC v1.3.0');
    expect(deps.notify).toHaveBeenCalledWith(
      'info',
      'MIAC v1.3.0 is downloaded. It is installed when you restart MIAC.',
    );
    expect(deps.confirmRestart).toHaveBeenCalledWith('MIAC v1.3.0');
    expect(timeouts.size + intervals.size).toBe(0);
    await Promise.resolve();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('restarts into the update when the user picks Restart now', async () => {
    const { emit, updater } = setup({ confirmRestart: async () => true });
    emit('update-downloaded', {}, '', '');
    await vi.waitFor(() => expect(updater.quitAndInstall).toHaveBeenCalled());
  });

  it('uses a generic name when Squirrel gives none, and prompts once', () => {
    const { emit, deps } = setup();
    emit('update-downloaded', {}, '', undefined);
    emit('update-downloaded', {}, '', undefined);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith(
      'info',
      'A new version of MIAC is downloaded. It is installed when you restart MIAC.',
    );
    expect(deps.confirmRestart).toHaveBeenCalledWith(undefined);
  });

  it('stop() cancels the timers', () => {
    const { handle, timeouts, intervals } = setup();
    handle?.stop();
    expect(timeouts.size + intervals.size).toBe(0);
  });
});
