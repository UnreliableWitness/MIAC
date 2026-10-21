import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIN_CONTRAST, TERMINAL_THEMES, terminalTheme } from './terminalTheme';

function lum(hex: string): number {
  const f = (i: number) => {
    const x = parseInt(hex.slice(1 + i, 3 + i), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(0) + 0.7152 * f(2) + 0.0722 * f(4);
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const tokens = readFileSync(
  path.join(__dirname, 'styles', 'tokens.css'),
  'utf8',
);
const terminalToken = (block: string) =>
  /--bg-terminal:\s*([^;]+);/.exec(block)?.[1].trim();

describe('terminal themes', () => {
  it('keeps the dark ADO page ground, blue cursor and selection', () => {
    const t = TERMINAL_THEMES.dark;
    expect(t.background).toBe('#201f1e');
    expect(t.cursor).toBe('#5ca9f2');
    expect(t.selectionBackground).toBe('rgba(0,120,212,0.4)');
    expect(t.brightBlack).toBe('#8a8886');
  });

  it('draws light terminals on a soft off-white, not white (#93)', () => {
    const bg = terminalTheme('light').background!;
    expect(bg).not.toBe('#ffffff');
    expect(lum(bg)).toBeLessThan(lum('#faf9f8'));
    expect(terminalTheme('light').cursorAccent).toBe(bg);
  });

  it('matches --bg-terminal in tokens.css in both schemes', () => {
    const light = tokens.slice(tokens.indexOf('prefers-color-scheme: light'));
    expect(terminalToken(tokens)).toBe(TERMINAL_THEMES.dark.background);
    expect(terminalToken(light)).toBe(TERMINAL_THEMES.light.background);
  });

  it('has soft but clear text and readable ANSI colours on the light ground', () => {
    const t = TERMINAL_THEMES.light;
    const bg = t.background!;
    const fg = ratio(t.foreground!, bg);
    expect(fg).toBeGreaterThan(9);
    expect(fg).toBeLessThan(15);
    const ansi = [
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'brightBlack',
      'brightRed',
      'brightGreen',
      'brightYellow',
      'brightBlue',
      'brightMagenta',
      'brightCyan',
    ] as const;
    for (const k of ansi)
      expect(ratio(t[k]!, bg), k).toBeGreaterThanOrEqual(4.5);
  });

  it('lifts low-contrast text in light only', () => {
    expect(MIN_CONTRAST).toEqual({ light: 4.5, dark: 1 });
  });

  it('defines the same colours in both themes', () => {
    expect(Object.keys(TERMINAL_THEMES.light).sort()).toEqual(
      Object.keys(TERMINAL_THEMES.dark).sort(),
    );
  });
});
