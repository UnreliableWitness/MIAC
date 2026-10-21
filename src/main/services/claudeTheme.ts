import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ColorScheme } from '../../shared/theme';

/**
 * Claude Code draws with its own theme (Settings `theme`: dark, light, their -daltonized and -ansi variants, custom
 * ones, or `auto`). A user's `dark` on a light Shellie terminal gives near-black prompt bars and pale text (#93), so
 * Claude Code tabs pass a theme through `--settings`. `auto` asks the terminal's background (OSC 11, which xterm
 * answers from the current theme), falls back to COLORFGBG, and asks again when the terminal reports a scheme change
 * (CSI ? 997 ; 1|2 n, see TerminalManager), so it follows Shellie live. Colour-blind and ANSI-only choices have no
 * auto variant, so they get the variant for the scheme on screen at launch; a custom theme is left alone.
 * Checked against claude 2.1.303 (2026-10-21).
 */
export function claudeThemeFor(
  userTheme: unknown,
  scheme: ColorScheme,
): string | null {
  if (typeof userTheme === 'string') {
    if (userTheme.startsWith('custom:')) return null;
    const family = /^(?:dark|light)-(daltonized|ansi)$/.exec(userTheme)?.[1];
    if (family) return `${scheme}-${family}`;
  }
  return 'auto';
}

const readTheme = (file: string): unknown => {
  try {
    return (JSON.parse(readFileSync(file, 'utf8')) as { theme?: unknown })
      .theme;
  } catch {
    return undefined;
  }
};

/** The theme the user picked in Claude Code: its settings.json, else the older global config. Never throws. */
export function readClaudeTheme(env: NodeJS.ProcessEnv = process.env): unknown {
  const dir = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return (
    readTheme(path.join(dir, 'settings.json')) ??
    readTheme(
      env.CLAUDE_CONFIG_DIR
        ? path.join(dir, '.claude.json')
        : path.join(os.homedir(), '.claude.json'),
    )
  );
}

/**
 * A settings file holding only the theme, for `claude --settings <file>` (merged over the user's settings, never
 * written back). A file, not inline JSON: Windows PowerShell 5.1 drops the quotes of JSON passed to a native command.
 */
export function claudeThemeSettingsFile(dir: string, theme: string): string {
  const file = path.join(dir, `claude-theme-${theme}.json`);
  const content = `${JSON.stringify({ theme })}\n`;
  let current: string | null = null;
  try {
    current = readFileSync(file, 'utf8');
  } catch {
    /* not written yet */
  }
  if (current !== content) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, content);
  }
  return file;
}

/** COLORFGBG ("foreground;background" as ANSI colour numbers) for programs that read it, Claude Code's `auto` too. */
export const colorFgBg = (scheme: ColorScheme): string =>
  scheme === 'light' ? '0;15' : '15;0';
