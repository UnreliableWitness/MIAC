import path from 'node:path';

/** Worktrees for `/src/webshop` live in `/src/webshop.worktrees/<slug>`. */
export function worktreeRoot(repoPath: string): string {
  const clean = path.resolve(repoPath);
  return path.join(path.dirname(clean), `${path.basename(clean)}.worktrees`);
}

/** Git prints `C:/x/y` on Windows; this gives the native form (`C:\x\y`). A no-op on POSIX. */
export function nativePath(p: string): string {
  return path.resolve(p);
}

/** Compares two paths in native form; case-insensitive on Windows. */
export function samePath(a: string, b: string): boolean {
  const x = nativePath(a);
  const y = nativePath(b);
  return process.platform === 'win32'
    ? x.toLowerCase() === y.toLowerCase()
    : x === y;
}
