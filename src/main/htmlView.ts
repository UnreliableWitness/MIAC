import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isInside, samePath } from './paths';

/** The scheme HTML files opened in a Shellie tab are served on (registered as privileged in main.ts). */
export const VIEW_SCHEME = 'shellie-view';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

/** The Content-Type a viewed file is served with; unknown types are not guessed. */
export const contentType = (file: string): string =>
  TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

type ViewFs = {
  realpath(p: string): Promise<string>;
  stat(p: string): Promise<{ isFile(): boolean }>;
};

/** What one token gives access to: a folder, or a single file when the folder is too wide (a root, the home folder). */
type Grant = { root: string; only: string | null };

/**
 * Grants for HTML files opened in a Shellie tab. A grant serves the file's folder (so its CSS, scripts and images
 * load) under a random token; it lasts for the app run.
 */
export class HtmlViews {
  private readonly grants = new Map<string, Grant>();
  private readonly byKey = new Map<string, string>();
  private readonly fs: ViewFs;
  private readonly home: string;
  private readonly token: () => string;

  constructor(deps: { fs?: ViewFs; home?: string; token?: () => string } = {}) {
    this.fs = deps.fs ?? fs;
    this.home = deps.home ?? os.homedir();
    this.token = deps.token ?? (() => randomBytes(16).toString('hex'));
  }

  /** A `shellie-view:` URL for a file; `realFile` must be its real path (symlinks followed). */
  grant(realFile: string): string {
    const file = path.resolve(realFile);
    const root = path.dirname(file);
    const wide = path.dirname(root) === root || samePath(root, this.home);
    const only = wide ? file : null;
    const key = `${root}\0${only ?? ''}`;
    let token = this.byKey.get(key);
    if (!token) {
      // The URL host is lowercased by the URL parser: tokens are lowercase.
      token = this.token().toLowerCase();
      this.grants.set(token, { root, only });
      this.byKey.set(key, token);
    }
    return `${VIEW_SCHEME}://${token}/${encodeURIComponent(path.basename(file))}`;
  }

  /** The real path of the regular file a `shellie-view:` URL names, or null when it is not granted or not there. */
  async lookup(url: string): Promise<string | null> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (u.protocol !== `${VIEW_SCHEME}:`) return null;
    const g = this.grants.get(u.hostname);
    if (!g) return null;
    let parts: string[];
    try {
      parts = u.pathname
        .split('/')
        .filter(Boolean)
        .map((s) => decodeURIComponent(s));
    } catch {
      return null;
    }
    if (parts.length === 0 || parts.some((s) => s.includes('\0'))) return null;
    const joined = path.resolve(g.root, ...parts);
    if (!isInside(g.root, joined)) return null;
    let real: string;
    try {
      real = await this.fs.realpath(joined);
      if (!(await this.fs.stat(real)).isFile()) return null;
    } catch {
      return null;
    }
    if (g.only ? !samePath(g.only, real) : !isInside(g.root, real)) return null;
    return real;
  }
}

const NOT_FOUND = () =>
  new Response('Not found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });

/** The `shellie-view:` protocol handler's response for a request URL. */
export async function serveView(
  views: HtmlViews,
  url: string,
  readFile: (p: string) => Promise<Uint8Array> = (p) => fs.readFile(p),
): Promise<Response> {
  const real = await views.lookup(url);
  if (!real) return NOT_FOUND();
  let body: Uint8Array;
  try {
    body = await readFile(real);
  } catch {
    return NOT_FOUND();
  }
  return new Response(body as BodyInit, {
    headers: {
      'Content-Type': contentType(real),
      'X-Content-Type-Options': 'nosniff',
      // Reload in the tab shows the file as it is now.
      'Cache-Control': 'no-store',
    },
  });
}
