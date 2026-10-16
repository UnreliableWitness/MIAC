import { describe, expect, it, vi } from 'vitest';
import { pasteInto, registerTerminal } from './terminalRegistry';

const fake = (bracketed: boolean) =>
  ({
    paste: vi.fn(),
    focus: vi.fn(),
    modes: { bracketedPasteMode: bracketed },
  }) as never;

describe('terminalRegistry', () => {
  it('pastes into a registered terminal with the bracketed flag, and not after unregister', () => {
    const t = fake(true);
    const off = registerTerminal('a', t);
    expect(pasteInto('a', (b) => (b ? 'multi\nline' : 'one'))).toBe(true);
    expect(
      (t as { paste: ReturnType<typeof vi.fn> }).paste,
    ).toHaveBeenCalledWith('multi\nline');
    off();
    expect(pasteInto('a', () => 'x')).toBe(false);
  });
  it('builds a single line when bracketed paste is off', () => {
    const t = fake(false);
    registerTerminal('b', t);
    pasteInto('b', (b) => (b ? 'multi\nline' : 'one'));
    expect(
      (t as { paste: ReturnType<typeof vi.fn> }).paste,
    ).toHaveBeenCalledWith('one');
  });
});
