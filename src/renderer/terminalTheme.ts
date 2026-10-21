import type { ITheme } from '@xterm/xterm';
import type { ColorScheme } from '../shared/theme';

/**
 * xterm colours (xterm needs literal values, not CSS variables); the backgrounds match `--bg-terminal` in tokens.css.
 * Dark: VS Code Dark Modern ANSI on the ADO page ground. Light (#93): GitHub Light's ANSI, darkened where they were
 * under 4.5:1 on the soft off-white ground, with a softer near-black text, so nothing glares and nothing is faint.
 */
export const TERMINAL_THEMES: Record<ColorScheme, ITheme> = {
  dark: {
    background: '#201f1e',
    foreground: '#e6e6e6',
    cursor: '#5ca9f2',
    cursorAccent: '#201f1e',
    selectionBackground: 'rgba(0,120,212,0.4)',
    selectionInactiveBackground: 'rgba(0,120,212,0.2)',
    scrollbarSliderBackground: 'rgba(121,121,121,0.4)',
    scrollbarSliderHoverBackground: 'rgba(100,100,100,0.7)',
    scrollbarSliderActiveBackground: 'rgba(191,191,191,0.4)',
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
    background: '#f7f6f4',
    foreground: '#323130',
    cursor: '#005fb8',
    cursorAccent: '#f7f6f4',
    selectionBackground: 'rgba(0,120,212,0.22)',
    selectionInactiveBackground: 'rgba(0,120,212,0.12)',
    scrollbarSliderBackground: 'rgba(100,100,100,0.3)',
    scrollbarSliderHoverBackground: 'rgba(100,100,100,0.5)',
    scrollbarSliderActiveBackground: 'rgba(0,0,0,0.45)',
    black: '#24292f',
    red: '#cf222e',
    green: '#116329',
    yellow: '#7d4e00',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#656d76',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#1a7f37',
    brightYellow: '#633c01',
    brightBlue: '#0550ae',
    brightMagenta: '#6639ba',
    brightCyan: '#1b6e79',
    brightWhite: '#8c959f',
  },
};

/**
 * xterm's minimumContrastRatio per scheme. Light lifts any text under 4.5:1 (dim text under half that), as VS Code
 * does: programs written for dark terminals (pale yellow, bright white, light blue) stay readable. Dark keeps colours
 * as programs send them.
 */
export const MIN_CONTRAST: Record<ColorScheme, number> = {
  dark: 1,
  light: 4.5,
};

export const terminalTheme = (s: ColorScheme): ITheme => TERMINAL_THEMES[s];
