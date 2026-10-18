import { beforeEach, describe, expect, it } from 'vitest';
import { migratePrefs } from './migratePrefs';

describe('migratePrefs', () => {
  beforeEach(() => localStorage.clear());

  it('copies miac.* keys to shellie.* without overwriting', () => {
    localStorage.setItem('miac.ui.focus', 'true');
    localStorage.setItem('miac.ui.pr.r1', 'false');
    localStorage.setItem('shellie.ui.pr.r1', 'true');
    expect(migratePrefs(localStorage)).toBe(1);
    expect(localStorage.getItem('shellie.ui.focus')).toBe('true');
    expect(localStorage.getItem('shellie.ui.pr.r1')).toBe('true');
  });

  it('runs once', () => {
    localStorage.setItem('miac.a', '1');
    expect(migratePrefs(localStorage)).toBe(1);
    localStorage.setItem('miac.b', '2');
    expect(migratePrefs(localStorage)).toBe(0);
    expect(localStorage.getItem('shellie.b')).toBeNull();
  });
});
