import { statSync } from 'node:fs';
import path from 'node:path';

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** Finds an executable on PATH. On Windows each PATHEXT extension is tried, upper and lower case. */
export function which(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = isFile,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const dirs = (env.PATH ?? env.Path ?? '')
    .split(win ? ';' : ':')
    .filter(Boolean);
  const exts = win
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      for (const candidate of win ? [ext, ext.toLowerCase()] : [ext]) {
        const full = p.join(dir, name + candidate);
        if (exists(full)) return full;
      }
    }
  }
  return null;
}
