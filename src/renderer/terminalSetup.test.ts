import { describe, expect, it } from 'vitest';
import { TERMINAL_FONT, terminalOptions } from './terminalSetup';

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
});
