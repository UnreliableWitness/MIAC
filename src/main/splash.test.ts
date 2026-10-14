import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SplashReporter, type SplashWindowLike } from './splash';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { getVersion: () => '1.0.0' },
}));

function stub() {
  let ready: () => void = () => {};
  let destroyed = false;
  const sent: [string, unknown[]][] = [];
  const win: SplashWindowLike = {
    isDestroyed: () => destroyed,
    webContents: {
      send: (c, ...a) => {
        sent.push([c, a]);
      },
    },
    close: vi.fn(() => {
      destroyed = true;
    }),
    once: (_e, fn) => {
      ready = fn;
    },
  };
  return {
    win,
    sent,
    show: () => ready(),
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
  it('sends steps and failures', () => {
    const s = stub();
    const r = new SplashReporter(s.win);
    r.step('Loading tasks');
    r.fail('state.json: EACCES');
    expect(s.sent).toEqual([
      ['splash:step', ['Loading tasks']],
      ['splash:fail', ['state.json: EACCES']],
    ]);
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
