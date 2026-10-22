import { beforeEach, describe, expect, it } from 'vitest';
import type { ColorScheme } from '../../shared/theme';
import { ClaudeRetheme, QUIET_MS, unsentAfter } from './ClaudeRetheme';

describe('unsentAfter', () => {
  it('counts typed and pasted text until Enter or Ctrl+C', () => {
    expect(unsentAfter(false, 'fix the')).toBe(true);
    expect(unsentAfter(true, '\r')).toBe(false);
    expect(unsentAfter(false, 'go\r')).toBe(false);
    expect(unsentAfter(false, 'go\rmore')).toBe(true);
    expect(unsentAfter(true, '\x03')).toBe(false);
    expect(unsentAfter(false, '\x1b[200~pasted\x1b[201~')).toBe(true);
  });

  it('ignores keys and focus reports that add no text', () => {
    for (const keys of [
      '\x1b[A',
      '\x1bOB',
      '\x1b[I',
      '\x1b[O',
      '\x1b',
      '\x7f',
      '\t',
    ])
      expect(unsentAfter(false, keys)).toBe(false);
    expect(unsentAfter(true, '\x1b[A')).toBe(true);
  });
});

describe('ClaudeRetheme', () => {
  let now: number;
  let scheme: ColorScheme;
  let alive: Set<string>;
  let restarted: string[];
  let r: ClaudeRetheme;

  beforeEach(() => {
    now = 0;
    scheme = 'light';
    alive = new Set(['c1']);
    restarted = [];
    r = new ClaudeRetheme({
      now: () => now,
      scheme: () => scheme,
      alive: (id) => alive.has(id),
      restart: (id) => {
        restarted.push(id);
        r.spawned(id, scheme);
      },
    });
  });

  it('resumes a tab fixed to the other scheme once it is quiet, and only once', () => {
    r.spawned('c1', 'light');
    now = QUIET_MS;
    r.tick();
    expect(restarted).toEqual([]);
    scheme = 'dark';
    r.tick();
    expect(restarted).toEqual(['c1']);
    now += QUIET_MS;
    r.tick();
    expect(restarted).toEqual(['c1']);
  });

  it('leaves tabs that follow the terminal alone', () => {
    r.spawned('c1', null);
    scheme = 'dark';
    now = QUIET_MS;
    r.tick();
    expect(restarted).toEqual([]);
  });

  it('waits while Claude works, asks or prints, and while the prompt holds text', () => {
    r.spawned('c1', 'light');
    scheme = 'dark';
    now = QUIET_MS;
    r.status('c1', 'working');
    r.tick();
    r.status('c1', 'blocked');
    r.tick();
    r.status('c1', 'idle');
    r.input('c1', 'half a');
    r.tick();
    expect(restarted).toEqual([]);
    r.input('c1', ' thought\r');
    r.output('c1');
    r.tick();
    expect(restarted).toEqual([]);
    now += QUIET_MS;
    r.tick();
    expect(restarted).toEqual(['c1']);
  });

  it('forgets tabs that exited or were closed', () => {
    r.spawned('c1', 'light');
    r.spawned('c2', 'light');
    r.exit('c1');
    scheme = 'dark';
    now = QUIET_MS;
    r.tick();
    expect(restarted).toEqual([]);
    alive.add('c2');
    r.tick();
    expect(restarted).toEqual([]);
  });
});
