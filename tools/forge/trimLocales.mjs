// Removes the Chromium locale packs we do not ship from an extracted Electron folder (Windows and Linux,
// where they sit in <app>/locales/*.pak). The app UI is English; Chromium only uses the pack for its
// own strings (context menus, dialogs). Missing packs fall back to en-US. macOS is left alone: its
// locales are .lproj folders inside the framework bundle, and the .app is signed as a whole.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

export const KEEP_LOCALES = ['en-US', 'nl'];

/**
 * @param {string} buildPath the extracted Electron folder (the one that holds locales/)
 * @param {string} platform the target platform (win32, linux, darwin, mas)
 * @param {string[]} [keep] locale names to keep, without .pak
 * @param {(message: string) => void} [warn]
 * @returns {{ removed: string[] }}
 */
export function trimLocales(
  buildPath,
  platform,
  keep = KEEP_LOCALES,
  warn = (m) => console.warn(m),
) {
  if (platform !== 'win32' && platform !== 'linux') return { removed: [] };
  const dir = path.join(buildPath, 'locales');
  if (!existsSync(dir)) {
    warn(`trimLocales: no locales folder in ${buildPath}, nothing trimmed`);
    return { removed: [] };
  }
  const kept = new Set(keep.map((l) => `${l}.pak`));
  const files = readdirSync(dir);
  for (const k of kept)
    if (!files.includes(k)) warn(`trimLocales: ${k} is missing in ${dir}`);
  const removed = files
    .filter((f) => f.endsWith('.pak') && !kept.has(f))
    .sort();
  for (const f of removed) rmSync(path.join(dir, f), { force: true });
  return { removed };
}
