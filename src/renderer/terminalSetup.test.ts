import { describe, expect, it } from 'vitest';
import {
  TERMINAL_FONT,
  followColorScheme,
  terminalOptions,
} from './terminalSetup';
import { TERMINAL_THEMES } from './terminalTheme';
import { setTestColorScheme } from './testColorScheme';

describe('terminalOptions', () => {
  it('tells xterm about ConPTY on Windows', () => {
    expect(terminalOptions(22631).windowsPty).toEqual({
      backend: 'conpty',
      buildNumber: 22631,
    });
  });

  it('leaves windowsPty unset elsewhere', () => {
    expect(terminalOptions(null)).not.toHaveProperty('windowsPty');
  });

  it('draws box and block characters itself and uses only system terminal fonts', () => {
    const o = terminalOptions(null);
    expect(o.customGlyphs).toBe(true);
    expect(o.fontFamily).toBe(TERMINAL_FONT);
    expect(TERMINAL_FONT).toMatch(/^'Cascadia Mono', Consolas,/);
    expect(TERMINAL_FONT).not.toMatch(/JetBrains/);
  });

  it('starts a terminal in the scheme on screen', () => {
    expect(terminalOptions(null).theme).toBe(TERMINAL_THEMES.dark);
    setTestColorScheme('light');
    expect(terminalOptions(null).theme).toBe(TERMINAL_THEMES.light);
  });
});

describe('followColorScheme', () => {
  it('re-colours the terminal on a switch, until unsubscribed', () => {
    const t = { options: {} };
    const off = followColorScheme(t);
    setTestColorScheme('light');
    expect(t.options).toEqual({ theme: TERMINAL_THEMES.light });
    off();
    setTestColorScheme('dark');
    expect(t.options).toEqual({ theme: TERMINAL_THEMES.light });
  });
});
