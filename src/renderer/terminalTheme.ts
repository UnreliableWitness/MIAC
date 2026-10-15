import type { ITheme } from '@xterm/xterm';

/** xterm colours matched to tokens.css (xterm needs literal values, not CSS variables); ANSI from VS Code Dark Modern. */
export const TERMINAL_THEME: ITheme = {
  background: '#201f1e',
  foreground: '#e6e6e6',
  cursor: '#5ca9f2',
  cursorAccent: '#201f1e',
  selectionBackground: 'rgba(0,120,212,0.4)',
  black: '#1b1a19',
  red: '#f1707b',
  green: '#6ccb5f',
  yellow: '#f7b955',
  blue: '#5ca9f2',
  magenta: '#c586c0',
  cyan: '#4ec9b0',
  white: '#e6e6e6',
  brightBlack: '#8a8886',
  brightRed: '#f59ba2',
  brightGreen: '#92dd88',
  brightYellow: '#fad08a',
  brightBlue: '#8cc4f7',
  brightMagenta: '#d7a8d3',
  brightCyan: '#7fdcc8',
  brightWhite: '#ffffff',
};
