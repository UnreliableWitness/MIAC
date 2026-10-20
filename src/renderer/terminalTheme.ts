import type { ITheme } from '@xterm/xterm';
import type { ColorScheme } from '../shared/theme';

/** xterm colours matched to tokens.css (xterm needs literal values, not CSS variables); ANSI from VS Code Dark Modern / Light Modern. */
export const TERMINAL_THEMES: Record<ColorScheme, ITheme> = {
  dark: {
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
  },
  light: {
    background: '#faf9f8',
    foreground: '#1f1f1f',
    cursor: '#005fb8',
    cursorAccent: '#faf9f8',
    selectionBackground: 'rgba(0,120,212,0.25)',
    black: '#000000',
    red: '#cd3131',
    green: '#107c10',
    yellow: '#949800',
    blue: '#0451a5',
    magenta: '#bc05bc',
    cyan: '#0598bc',
    white: '#555555',
    brightBlack: '#666666',
    brightRed: '#cd3131',
    brightGreen: '#14ce14',
    brightYellow: '#b5ba00',
    brightBlue: '#0451a5',
    brightMagenta: '#bc05bc',
    brightCyan: '#0598bc',
    brightWhite: '#a5a5a5',
  },
};

export const terminalTheme = (s: ColorScheme): ITheme => TERMINAL_THEMES[s];
