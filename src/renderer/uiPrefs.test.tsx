import { beforeEach, describe, expect, it } from 'vitest';
import { readPrChoice, readPrefs, writePrChoice, writePref } from './uiPrefs';

beforeEach(() => localStorage.clear());

describe('uiPrefs', () => {
  it('defaults to expanded nav and no focus', () => {
    expect(readPrefs()).toEqual({ navCollapsed: false, focus: false });
  });
  it('round-trips', () => {
    writePref('focus', true);
    writePref('navCollapsed', true);
    expect(localStorage.getItem('shellie.ui.focus')).toBe('true');
    expect(readPrefs()).toEqual({ navCollapsed: true, focus: true });
  });
  it('treats bad values as defaults', () => {
    localStorage.setItem('shellie.ui.focus', '{"x":1}');
    localStorage.setItem('shellie.ui.navCollapsed', 'yes');
    expect(readPrefs()).toEqual({ navCollapsed: false, focus: false });
  });
  it('survives a storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    expect(readPrefs(broken)).toEqual({ navCollapsed: false, focus: false });
    expect(() => writePref('focus', true, broken)).not.toThrow();
  });
});

describe('pull request choice', () => {
  it('defaults to false and is kept per repo', () => {
    expect(readPrChoice('r1')).toBe(false);
    writePrChoice('r1', true);
    expect(readPrChoice('r1')).toBe(true);
    expect(readPrChoice('r2')).toBe(false);
    writePrChoice('r1', false);
    expect(readPrChoice('r1')).toBe(false);
  });
  it('survives a storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    expect(readPrChoice('r1', broken)).toBe(false);
    expect(() => writePrChoice('r1', true, broken)).not.toThrow();
  });
});
