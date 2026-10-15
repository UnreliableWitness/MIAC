import type { ITheme } from '@xterm/xterm';

/** xterm colours matched to tokens.css (xterm needs literal values, not CSS variables). */
export const TERMINAL_THEME: ITheme = {
  background: '#07080c',
  foreground: '#e7e6e2',
  cursor: '#f0a443',
  cursorAccent: '#07080c',
  selectionBackground: 'rgba(240,164,67,0.25)',
  black: '#0c0e14',
  red: '#f0a0a0',
  green: '#8fd6a4',
  yellow: '#f0c27a',
  blue: '#7fb2ff',
  magenta: '#c9a4f0',
  cyan: '#86d1d6',
  white: '#e7e6e2',
  brightBlack: '#7d8598',
  brightRed: '#ffbcbc',
  brightGreen: '#b2ecc3',
  brightYellow: '#f6dcae',
  brightBlue: '#a9cbff',
  brightMagenta: '#dcc3f7',
  brightCyan: '#b0e6ea',
  brightWhite: '#f3ead8',
};
