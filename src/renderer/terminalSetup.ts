import type { ITerminalOptions, Terminal } from '@xterm/xterm';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { api } from './api';
import { TERMINAL_THEME } from './terminalTheme';

/**
 * The system's own terminal fonts (Windows Terminal's Cascadia Mono, then Consolas; SF Mono or Menlo on macOS), nothing
 * bundled or preferred by Shellie. Each has its own bold, so bold text never falls back to a font with another baseline.
 */
export const TERMINAL_FONT =
  "'Cascadia Mono', Consolas, 'SF Mono', Menlo, monospace";
const FONT_SIZE = 13;

export function terminalOptions(windowsBuild: number | null): ITerminalOptions {
  return {
    fontFamily: TERMINAL_FONT,
    fontSize: FONT_SIZE,
    theme: TERMINAL_THEME,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: true,
    // Box-drawing and block characters (Claude Code's logo, TUI borders) drawn as pixel-exact shapes, not font glyphs.
    customGlyphs: true,
    // Tells xterm the pty is ConPTY, so it leaves line wrapping and reflow to ConPTY instead of fighting its redraws.
    ...(windowsBuild
      ? {
          windowsPty: { backend: 'conpty' as const, buildNumber: windowsBuild },
        }
      : {}),
  };
}

let info: Promise<number | null> | null = null;
/** The Windows build number, asked once per window. */
export function windowsBuild(): Promise<number | null> {
  info ??= api()
    .invoke('app:info')
    .then((i) => i.windowsBuild ?? null)
    .catch(() => null);
  return info;
}

/** Wide-character widths per Unicode 11 (emoji, CJK), and the WebGL renderer when the GPU allows it; the DOM renderer otherwise. */
export function loadRenderer(t: Terminal): void {
  try {
    t.loadAddon(new Unicode11Addon());
    t.unicode.activeVersion = '11';
  } catch {
    /* keep the default widths */
  }
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    t.loadAddon(webgl);
  } catch {
    /* no WebGL: the DOM renderer stays */
  }
}
