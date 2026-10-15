import { describe, expect, it } from 'vitest';
import { TERMINAL_THEME } from './terminalTheme';

describe('TERMINAL_THEME', () => {
  it('uses the ADO page ground, a blue cursor and a blue selection', () => {
    expect(TERMINAL_THEME.background).toBe('#201f1e');
    expect(TERMINAL_THEME.cursor).toBe('#5ca9f2');
    expect(TERMINAL_THEME.selectionBackground).toBe('rgba(0,120,212,0.4)');
    expect(TERMINAL_THEME.brightBlack).toBe('#8a8886');
  });
});
