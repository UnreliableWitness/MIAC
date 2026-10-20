import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { contentType, HtmlViews, serveView } from './htmlView';

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'shellie-view-')));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function site() {
  const dir = mkdtempSync(path.join(tmp, 'site-'));
  mkdirSync(path.join(dir, 'css'));
  writeFileSync(path.join(dir, 'index.html'), '<h1>hi</h1>');
  writeFileSync(path.join(dir, 'css', 'a b.css'), 'h1{}');
  writeFileSync(path.join(tmp, 'secret.txt'), 'secret');
  return dir;
}

let n = 0;
const views = (home = path.join(tmp, 'nohome')) =>
  new HtmlViews({ home, token: () => `tok${++n}` });

describe('HtmlViews', () => {
  it('serves the granted file and its folder', async () => {
    const dir = site();
    const v = views();
    const url = v.grant(path.join(dir, 'index.html'));
    expect(url).toMatch(/^shellie-view:\/\/tok\d+\/index\.html$/);
    expect(await v.lookup(url)).toBe(path.join(dir, 'index.html'));
    expect(await v.lookup(new URL('css/a%20b.css', url).toString())).toBe(
      path.join(dir, 'css', 'a b.css'),
    );
  });
  it('reuses the token for the same folder', () => {
    const dir = site();
    const v = views();
    const a = new URL(v.grant(path.join(dir, 'index.html')));
    const b = new URL(v.grant(path.join(dir, 'css', '..', 'other.html')));
    expect(a.host).toBe(b.host);
  });
  it('refuses to leave the folder with ..', async () => {
    const dir = site();
    const v = views();
    const url = v.grant(path.join(dir, 'index.html'));
    const host = new URL(url).host;
    for (const p of ['../secret.txt', '..%2Fsecret.txt', '%2E%2E/secret.txt'])
      expect(await v.lookup(`shellie-view://${host}/${p}`)).toBeNull();
    expect(
      await v.lookup(`shellie-view://${host}/css/..%2F..%2Fsecret.txt`),
    ).toBeNull();
  });
  it('refuses a symlink that points out of the folder', async () => {
    const dir = site();
    symlinkSync(path.join(tmp, 'secret.txt'), path.join(dir, 'link.txt'));
    const v = views();
    const url = v.grant(path.join(dir, 'index.html'));
    expect(await v.lookup(new URL('link.txt', url).toString())).toBeNull();
  });
  it('refuses folders, missing files and unknown tokens', async () => {
    const dir = site();
    const v = views();
    const url = v.grant(path.join(dir, 'index.html'));
    expect(await v.lookup(new URL('css', url).toString())).toBeNull();
    expect(await v.lookup(new URL('nope.html', url).toString())).toBeNull();
    expect(await v.lookup(`shellie-view://${new URL(url).host}/`)).toBeNull();
    expect(await v.lookup('shellie-view://unknown/index.html')).toBeNull();
    expect(await v.lookup('file:///etc/passwd')).toBeNull();
    expect(await v.lookup('not a url')).toBeNull();
  });
  it('grants only the file itself in the home folder or a filesystem root', async () => {
    const home = site();
    writeFileSync(path.join(home, 'other.txt'), 'x');
    const v = views(home);
    const url = v.grant(path.join(home, 'index.html'));
    expect(await v.lookup(url)).toBe(path.join(home, 'index.html'));
    expect(await v.lookup(new URL('other.txt', url).toString())).toBeNull();
    expect(await v.lookup(new URL('css/a%20b.css', url).toString())).toBeNull();

    const root = path.parse(tmp).root;
    const fakeFs = {
      realpath: async (p: string) => p,
      stat: async () => ({ isFile: () => true }),
    };
    const r = new HtmlViews({ home, fs: fakeFs, token: () => 'rootok' });
    const rootUrl = r.grant(path.join(root, 'report.html'));
    expect(await r.lookup(rootUrl)).toBe(path.join(root, 'report.html'));
    expect(
      await r.lookup(new URL('etc/passwd', rootUrl).toString()),
    ).toBeNull();
  });
});

describe('serveView', () => {
  it('serves with the content type and nosniff, 404 otherwise', async () => {
    const dir = site();
    const v = views();
    const url = v.grant(path.join(dir, 'index.html'));
    const ok = await serveView(v, url);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await ok.text()).toBe('<h1>hi</h1>');
    const css = await serveView(v, new URL('css/a%20b.css', url).toString());
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
    const missing = await serveView(
      v,
      new URL('../secret.txt', url).toString(),
    );
    expect(missing.status).toBe(404);
  });
  it('knows the common web types and defaults to octet-stream', () => {
    expect(contentType('a.mjs')).toBe('text/javascript; charset=utf-8');
    expect(contentType('a.WOFF2')).toBe('font/woff2');
    expect(contentType('a.svg')).toBe('image/svg+xml');
    expect(contentType('a.exe')).toBe('application/octet-stream');
  });
});
