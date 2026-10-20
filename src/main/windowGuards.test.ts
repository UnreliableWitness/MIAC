import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { appUrlMatcher, guardWindow, trustedSender } from './windowGuards';

const dir = path.join(path.sep, 'app', 'resources', 'renderer', 'main_window');
const fileUrl = (p: string) => pathToFileURL(p).toString();

describe('appUrlMatcher', () => {
  it('in dev accepts only the Vite dev server origin', () => {
    const isApp = appUrlMatcher({
      devServerUrl: 'http://localhost:5173',
      dir,
    });
    expect(isApp('http://localhost:5173/')).toBe(true);
    expect(isApp('http://localhost:5173/index.html#x')).toBe(true);
    expect(isApp('http://localhost:5174/')).toBe(false);
    expect(isApp('https://localhost:5173/')).toBe(false);
    expect(isApp('https://evil.example/')).toBe(false);
    expect(isApp(fileUrl(path.join(dir, 'index.html')))).toBe(false);
  });
  it('packaged accepts only files inside the renderer folder', () => {
    const isApp = appUrlMatcher({ devServerUrl: undefined, dir });
    expect(isApp(fileUrl(path.join(dir, 'index.html')))).toBe(true);
    expect(isApp(`${fileUrl(path.join(dir, 'index.html'))}#v=1`)).toBe(true);
    expect(isApp(fileUrl(path.join(dir, '..', 'other', 'index.html')))).toBe(
      false,
    );
    expect(isApp(fileUrl(path.join(path.sep, 'etc', 'passwd')))).toBe(false);
    expect(isApp(`${fileUrl(dir)}-evil/index.html`)).toBe(false);
    expect(isApp('file://evil.example/share/index.html')).toBe(false);
    expect(isApp('https://evil.example/')).toBe(false);
    expect(isApp('not a url')).toBe(false);
    expect(isApp('')).toBe(false);
  });
});

function fakeContents() {
  const listeners = new Map<string, (e: unknown) => void>();
  let openHandler: ((d: { url: string }) => { action: string }) | null = null;
  return {
    listeners,
    open: (url: string) => openHandler!({ url }),
    wc: {
      on(event: string, fn: (e: unknown) => void) {
        listeners.set(event, fn);
      },
      setWindowOpenHandler(fn: (d: { url: string }) => { action: string }) {
        openHandler = fn;
      },
    },
  };
}

describe('guardWindow', () => {
  const isApp = (url: string) => url.startsWith('http://localhost:5173/');
  const navigate = (
    listeners: Map<string, (e: unknown) => void>,
    event: string,
    url: string,
  ) => {
    const e = { url, preventDefault: vi.fn() };
    listeners.get(event)!(e);
    return e.preventDefault.mock.calls.length > 0;
  };

  it.each(['will-navigate', 'will-frame-navigate', 'will-redirect'])(
    '%s away from the app is prevented, inside it is allowed',
    (event) => {
      const { wc, listeners } = fakeContents();
      guardWindow(wc as never, isApp, vi.fn());
      expect(navigate(listeners, event, 'https://evil.example/')).toBe(true);
      expect(navigate(listeners, event, 'file:///etc/passwd')).toBe(true);
      expect(navigate(listeners, event, 'http://localhost:5173/')).toBe(false);
    },
  );

  describe('sub-frames', () => {
    const frameNav = (
      listeners: Map<string, (e: unknown) => void>,
      url: string,
      isMainFrame: boolean,
      from = '',
    ) => {
      const e = {
        url,
        isMainFrame,
        frame: { url: from },
        preventDefault: vi.fn(),
      };
      listeners.get('will-frame-navigate')!(e);
      return e.preventDefault.mock.calls.length > 0;
    };
    const view = 'shellie-view://abc123/index.html';

    it('may show shellie-view pages; the main frame may not', () => {
      const { wc, listeners } = fakeContents();
      guardWindow(wc as never, isApp, vi.fn());
      expect(frameNav(listeners, view, false)).toBe(false);
      expect(frameNav(listeners, 'http://localhost:5173/x', false)).toBe(false);
      expect(frameNav(listeners, view, true)).toBe(true);
      expect(frameNav(listeners, 'file:///etc/passwd', false, view)).toBe(true);
      expect(frameNav(listeners, 'data:text/html,x', false, view)).toBe(true);
    });

    it('opens web links followed from a viewed page in the browser', () => {
      const { wc, listeners } = fakeContents();
      const openExternal = vi.fn(async () => undefined);
      guardWindow(wc as never, isApp, openExternal);
      expect(frameNav(listeners, 'https://example.com/a', false, view)).toBe(
        true,
      );
      expect(frameNav(listeners, 'https://u:p@example.com/', false, view)).toBe(
        true,
      );
      // A web iframe embedded by the page is not loaded and not opened.
      expect(
        frameNav(listeners, 'https://example.com/embed', false, 'about:blank'),
      ).toBe(true);
      // Main frame: still only cancelled.
      expect(frameNav(listeners, 'https://example.com/top', true, view)).toBe(
        true,
      );
      expect(openExternal.mock.calls).toEqual([['https://example.com/a']]);
    });
  });

  it('denies every new window and opens only allowed web links in the browser', () => {
    const { wc, open } = fakeContents();
    const openExternal = vi.fn(async () => undefined);
    guardWindow(wc as never, isApp, openExternal);
    expect(open('https://example.com/x')).toEqual({ action: 'deny' });
    expect(open('http://user:pw@example.com/')).toEqual({ action: 'deny' });
    expect(open('file:///etc/passwd')).toEqual({ action: 'deny' });
    expect(open('javascript:alert(1)')).toEqual({ action: 'deny' });
    expect(open('http://localhost:5173/')).toEqual({ action: 'deny' });
    expect(openExternal.mock.calls).toEqual([
      ['https://example.com/x'],
      ['http://localhost:5173/'],
    ]);
  });
});

describe('trustedSender', () => {
  const isApp = (url: string) => url === 'file:///app/index.html';
  it('accepts a frame on an app URL only', () => {
    expect(
      trustedSender({ senderFrame: { url: 'file:///app/index.html' } }, isApp),
    ).toBe(true);
    expect(
      trustedSender({ senderFrame: { url: 'https://evil.example/' } }, isApp),
    ).toBe(false);
    expect(trustedSender({ senderFrame: null }, isApp)).toBe(false);
    expect(trustedSender({}, isApp)).toBe(false);
  });
});
