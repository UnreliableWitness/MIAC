import { describe, expect, it } from 'vitest';
import {
  TERMINAL_FONT,
  followColorScheme,
  terminalOptions,
} from './terminalSetup';
import { MIN_CONTRAST, TERMINAL_THEMES } from './terminalTheme';
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
    expect(terminalOptions(null).minimumContrastRatio).toBe(MIN_CONTRAST.dark);
    setTestColorScheme('light');
    expect(terminalOptions(null).theme).toBe(TERMINAL_THEMES.light);
    expect(terminalOptions(null).minimumContrastRatio).toBe(MIN_CONTRAST.light);
  });
});

describe('followColorScheme', () => {
  it('re-colours the terminal on a switch, then reports it, until unsubscribed', () => {
    const t = { options: {} };
    const seen: unknown[] = [];
    const off = followColorScheme(t, (s) => seen.push([s, { ...t.options }]));
    setTestColorScheme('light');
    const light = {
      theme: TERMINAL_THEMES.light,
      minimumContrastRatio: MIN_CONTRAST.light,
    };
    expect(t.options).toEqual(light);
    // Reported after the re-colour, so a program asking for the background then gets the new one.
    expect(seen).toEqual([['light', light]]);
    off();
    setTestColorScheme('dark');
    expect(t.options).toEqual(light);
    expect(seen).toHaveLength(1);
  });
});
