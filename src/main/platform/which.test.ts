import { describe, expect, it } from 'vitest';
import { which } from './which';

describe('which', () => {
  it('walks PATH with PATHEXT on Windows-style env', () => {
    const files = new Set(['C:\\b\\claude.CMD', 'C:\\a\\pwsh.exe']);
    const env = { PATH: 'C:\\a;C:\\b', PATHEXT: '.COM;.EXE;.CMD' };
    const exists = (p: string) => files.has(p);
    expect(which('pwsh', env, exists, 'win32')).toBe('C:\\a\\pwsh.exe');
    expect(which('claude', env, exists, 'win32')).toBe('C:\\b\\claude.CMD');
    expect(which('nope', env, exists, 'win32')).toBeNull();
  });
});
