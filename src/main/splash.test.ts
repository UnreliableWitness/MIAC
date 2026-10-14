import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPLASH_CAP_MS, SplashReporter, type SplashWindowLike } from './splash';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { getVersion: () => '1.0.0' },
}));

function stub() {
  const handlers = new Map<string, () => void>();
  const emit = (e: string) => {
    const fn = handlers.get(e);
    handlers.delete(e);
    fn?.();
  };
  let destroyed = false;
  const sent: [string, unknown[]][] = [];
  const win: SplashWindowLike = {
    isDestroyed: () => destroyed,
    webContents: {
      send: (c, ...a) => {
        sent.push([c, a]);
      },
      once: (_e, fn) => {
        handlers.set('did-finish-load', fn);
      },
    },
    close: vi.fn(() => {
      destroyed = true;
    }),
    once: (e, fn) => {
      handlers.set(e, fn);
    },
  };
  return {
    win,
    sent,
    show: () => emit('ready-to-show'),
    loaded: () => emit('did-finish-load'),
    closed: () => {
      destroyed = true;
      emit('closed');
    },
    destroy: () => {
      destroyed = true;
    },
  };
}
const settled = async (p: Promise<unknown>) => {
  let done = false;
  void p.then(() => {
    done = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  return done;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SplashReporter', () => {
  it('done waits for the 2.2 s minimum after the window shows', async () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    const d = r.done();
    s.show();
    await vi.advanceTimersByTimeAsync(2199);
    expect(await settled(d)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(d)).toBe(true);
  });
  it('does not start the clock before the window shows', async () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    const d = r.done();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await settled(d)).toBe(false);
    s.show();
    await vi.advanceTimersByTimeAsync(2200);
    expect(await settled(d)).toBe(true);
  });
  it('skip resolves early', async () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    s.show();
    const d = r.done();
    r.skip();
    expect(await settled(d)).toBe(true);
  });
  it('sends steps and failures once the page has loaded', () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    s.loaded();
    r.step('Loading tasks');
    r.fail('state.json: EACCES');
    expect(s.sent).toEqual([
      ['splash:step', ['Loading tasks']],
      ['splash:fail', ['state.json: EACCES']],
    ]);
  });
  it('replays the last step and a failure reported before the page loaded', () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    r.step('Loading tasks');
    r.step('Starting usage receiver 127.0.0.1:4319');
    r.fail('state.json: EACCES');
    expect(s.sent).toEqual([]);
    s.loaded();
    expect(s.sent).toEqual([
      ['splash:step', ['Starting usage receiver 127.0.0.1:4319']],
      ['splash:fail', ['state.json: EACCES']],
    ]);
  });
  it('done settles when the splash closes before it shows', async () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    const d = r.done();
    s.closed();
    expect(await settled(d)).toBe(true);
  });
  it('done settles at the cap when the splash never shows', async () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    const d = r.done();
    await vi.advanceTimersByTimeAsync(SPLASH_CAP_MS - 1);
    expect(await settled(d)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(d)).toBe(true);
  });
  it('never resolves done after a failure, and keeps the window', async () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    s.show();
    const d = r.done();
    r.fail('boom');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await settled(d)).toBe(false);
    expect(s.win.close).not.toHaveBeenCalled();
  });
  it('is a no-op without a window (splash off)', async () => {
    const r = new SplashReporter(null);
    expect(() => {
      r.step('x');
      r.fail('y');
      r.close();
    }).not.toThrow();
    expect(await settled(r.done())).toBe(true);
    expect(await settled(r.fadeOut())).toBe(true);
    expect(r.active).toBe(false);
  });
  it('ignores calls after the window is destroyed, and done resolves', async () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    s.destroy();
    r.step('x');
    expect(s.sent).toEqual([]);
    expect(await settled(r.done())).toBe(true);
  });
  it('fadeOut tells the page and waits 200 ms', async () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    const f = r.fadeOut();
    expect(s.sent.at(-1)).toEqual(['splash:done', []]);
    await vi.advanceTimersByTimeAsync(199);
    expect(await settled(f)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(f)).toBe(true);
  });
});
