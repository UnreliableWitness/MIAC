import { describe, expect, it } from 'vitest';
import { TERMINAL_THEME } from './terminalTheme';

describe('TERMINAL_THEME', () => {
  it('uses the void ground, amber cursor and amber selection', () => {
    expect(TERMINAL_THEME.background).toBe('#07080c');
    expect(TERMINAL_THEME.cursor).toBe('#f0a443');
    expect(TERMINAL_THEME.selectionBackground).toBe('rgba(240,164,67,0.25)');
    expect(TERMINAL_THEME.brightBlack).toBe('#7d8598');
  });
});
