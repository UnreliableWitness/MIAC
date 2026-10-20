import { describe, expect, it } from 'vitest';
import { TERMINAL_THEMES, terminalTheme } from './terminalTheme';

describe('terminal themes', () => {
  it('keeps the dark ADO page ground, blue cursor and selection', () => {
    const t = TERMINAL_THEMES.dark;
    expect(t.background).toBe('#201f1e');
    expect(t.cursor).toBe('#5ca9f2');
    expect(t.selectionBackground).toBe('rgba(0,120,212,0.4)');
    expect(t.brightBlack).toBe('#8a8886');
  });

  it('draws light terminals on the light page ground', () => {
    expect(terminalTheme('light').background).toBe('#faf9f8');
    expect(terminalTheme('light').cursorAccent).toBe('#faf9f8');
  });

  it('defines the same colours in both themes', () => {
    expect(Object.keys(TERMINAL_THEMES.light).sort()).toEqual(
      Object.keys(TERMINAL_THEMES.dark).sort(),
    );
  });
});
