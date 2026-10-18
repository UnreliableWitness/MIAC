import { describe, expect, it, vi } from 'vitest';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  canAutoUpdate,
  releaseVersion,
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
    argv: ['Shellie.exe'],
    enabled: undefined,
    updater,
    onReady: vi.fn(),
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
      'https://update.electronjs.org/UnreliableWitness/Shellie/win32-x64/1.2.3',
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
      url: 'https://update.electronjs.org/UnreliableWitness/Shellie/win32-x64/1.2.3',
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
      argv: ['Shellie.exe', '--squirrel-firstrun'],
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
    expect(deps.onReady).not.toHaveBeenCalled();
  });

  it('on download: reports it ready once, stops checking and installs only when asked', () => {
    const { emit, deps, updater, handle, timeouts, intervals } = setup();
    expect(handle?.install()).toBe(false);
    emit('update-downloaded', {}, '', 'Shellie v1.3.0 (unsigned)');
    emit('update-downloaded', {}, '', 'Shellie v1.3.0 (unsigned)');
    expect(deps.onReady).toHaveBeenCalledTimes(1);
    expect(deps.onReady).toHaveBeenCalledWith('1.3.0');
    expect(timeouts.size + intervals.size).toBe(0);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(handle?.install()).toBe(true);
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('stop() cancels the timers', () => {
    const { handle, timeouts, intervals } = setup();
    handle?.stop();
    expect(timeouts.size + intervals.size).toBe(0);
  });
});

describe('releaseVersion', () => {
  it('finds the version in a release name, or gives null', () => {
    expect(releaseVersion('Shellie v1.0.3 (unsigned)')).toBe('1.0.3');
    expect(releaseVersion('1.2.0-beta.1')).toBe('1.2.0-beta.1');
    expect(releaseVersion('')).toBeNull();
    expect(releaseVersion(undefined)).toBeNull();
  });
});
