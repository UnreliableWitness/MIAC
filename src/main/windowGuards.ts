import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebContents } from 'electron';
import { allowedLink } from './docs/docsHandlers';
import { VIEW_SCHEME } from './htmlView';

/**
 * Where a window's own pages come from, the same values main.ts loads it with:
 * the Vite dev server in `npm start`, the renderer folder in a packaged build.
 */
export type AppSource = { devServerUrl: string | undefined; dir: string };

/** True for URLs that are the app's own pages; everything else is foreign content. */
export function appUrlMatcher(src: AppSource): (url: string) => boolean {
  if (src.devServerUrl) {
    const origin = new URL(src.devServerUrl).origin;
    return (url) => {
      try {
        return new URL(url).origin === origin;
      } catch {
        return false;
      }
    };
  }
  const dir = path.resolve(src.dir);
  return (url) => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'file:' || u.host !== '') return false;
      const rel = path.relative(dir, fileURLToPath(u));
      return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
    } catch {
      return false;
    }
  };
}

type Navigation = { url: string; preventDefault(): void };
/** `will-frame-navigate`: which frame navigates, and what it shows now. */
type FrameNavigation = Navigation & {
  isMainFrame?: boolean;
  frame?: { url: string } | null;
};
const isView = (url: string) => url.startsWith(`${VIEW_SCHEME}:`);
type GuardedContents = {
  on(event: string, fn: (e: Navigation) => void): unknown;
  setWindowOpenHandler: WebContents['setWindowOpenHandler'];
};

/**
 * Keeps a window on the app's own pages: navigation elsewhere is cancelled, and new windows
 * are never created (web links allowed for `links:open` go to the browser instead).
 * A sub-frame may also show `shellie-view:` pages (HTML files opened in a tab); a web link
 * clicked inside such a page opens in the browser, not in the frame.
 */
export function guardWindow(
  wc: GuardedContents,
  isApp: (url: string) => boolean,
  openExternal: (url: string) => Promise<void>,
): void {
  const stay = (e: Navigation) => {
    if (!isApp(e.url)) e.preventDefault();
  };
  const open = (url: string) =>
    openExternal(url).catch((e) =>
      console.error('[links] could not open a link', e),
    );
  wc.on('will-navigate', stay);
  wc.on('will-frame-navigate', (e: FrameNavigation) => {
    if (e.isMainFrame !== false) return stay(e);
    if (isView(e.url) || isApp(e.url)) return;
    e.preventDefault();
    // Only a link followed from a viewed page; a web iframe the page embeds is just not loaded.
    if (allowedLink(e.url) && isView(e.frame?.url ?? '')) void open(e.url);
  });
  wc.on('will-redirect', stay);
  wc.setWindowOpenHandler(({ url }) => {
    if (allowedLink(url)) void open(url);
    return { action: 'deny' };
  });
}

/** True when an IPC message comes from a frame showing one of the app's own pages. */
export function trustedSender(
  event: { senderFrame?: { url: string } | null },
  isApp: (url: string) => boolean,
): boolean {
  const url = event.senderFrame?.url;
  return typeof url === 'string' && isApp(url);
}
