import { describe, expect, it } from 'vitest';
import type { Interval } from '../../shared/time';
import { ActivityTracker } from './ActivityTracker';

function setup(limit = 300) {
  const s = { now: 0, idle: 0 };
  const out: Array<[string, Interval]> = [];
  const t = new ActivityTracker({
    now: () => s.now,
    idleSeconds: () => s.idle,
    idleLimitSeconds: () => limit,
    onInterval: (id, iv) => out.push([id, iv]),
  });
  return { s, out, t };
}

describe('ActivityTracker', () => {
  it('emits one interval for focused work on a task', () => {
    const { s, out, t } = setup();
    t.setTask('A');
    t.setFocused(true);
    s.now = 60_000;
    t.flush();
    expect(out).toEqual([['A', [0, 60_000]]]);
  });

  it('never counts two tasks at once', () => {
    const { s, out, t } = setup();
    t.setTask('A');
    t.setFocused(true);
    s.now = 10_000;
    t.setTask('B');
    s.now = 20_000;
    t.setTask('A');
    s.now = 30_000;
    t.flush();
    expect(out).toEqual([
      ['A', [0, 10_000]],
      ['B', [10_000, 20_000]],
      ['A', [20_000, 30_000]],
    ]);
  });

  it('records nothing while unfocused and starts anew on re-focus', () => {
    const { s, out, t } = setup();
    t.setTask('A');
    s.now = 30_000;
    t.flush();
    t.tick();
    expect(out).toEqual([]);
    t.setFocused(true);
    s.now = 40_000;
    t.setFocused(false);
    s.now = 50_000;
    t.setFocused(true);
    s.now = 55_000;
    t.flush();
    expect(out).toEqual([
      ['A', [30_000, 40_000]],
      ['A', [50_000, 55_000]],
    ]);
  });

  it('ends the interval where idleness began', () => {
    const { s, out, t } = setup();
    t.setTask('A');
    t.setFocused(true);
    s.now = 400_000;
    s.idle = 300;
    t.tick();
    expect(out).toEqual([['A', [0, 100_000]]]);
  });

  it('starts a new interval at the tick that finds the user back', () => {
    const { s, out, t } = setup();
    t.setTask('A');
    t.setFocused(true);
    s.now = 400_000;
    s.idle = 300;
    t.tick();
    s.now = 415_000;
    t.tick();
    expect(out.length).toBe(1);
    s.now = 415_000;
    s.idle = 0;
    t.tick();
    s.now = 430_000;
    t.flush();
    expect(out[1]).toEqual(['A', [415_000, 430_000]]);
  });

  it('never ends an interval before its start', () => {
    const { s, out, t } = setup();
    s.now = 1_000_000;
    t.setTask('A');
    t.setFocused(true);
    s.now = 1_010_000;
    s.idle = 600;
    t.tick();
    expect(out).toEqual([]);
  });

  it('suspend closes the interval at the suspend moment', () => {
    const { s, out, t } = setup();
    t.setTask('A');
    t.setFocused(true);
    s.now = 50_000;
    t.suspend();
    s.now = 65_000;
    t.tick();
    expect(out).toEqual([['A', [0, 50_000]]]);
    s.now = 80_000;
    t.resume();
    t.tick();
    s.now = 5_000_000;
    t.flush();
    expect(out).toEqual([
      ['A', [0, 50_000]],
      ['A', [80_000, 5_000_000]],
    ]);
  });

  it('keeps ignoring ticks while suspended', () => {
    const { s, out, t } = setup();
    t.setTask('A');
    t.setFocused(true);
    s.now = 50_000;
    t.suspend();
    s.now = 5_000_000;
    t.tick();
    s.now = 5_010_000;
    t.flush();
    expect(out).toEqual([['A', [0, 50_000]]]);
  });

  it('trims to the start of idleness when the task changes between ticks', () => {
    const { s, out, t } = setup();
    t.setTask('A');
    t.setFocused(true);
    s.now = 400_000;
    s.idle = 300;
    t.setTask('B');
    expect(out).toEqual([['A', [0, 100_000]]]);
  });

  it('flush keeps counting from now', () => {
    const { s, out, t } = setup();
    t.setTask('A');
    t.setFocused(true);
    s.now = 60_000;
    t.flush();
    s.now = 90_000;
    t.flush();
    expect(out).toEqual([
      ['A', [0, 60_000]],
      ['A', [60_000, 90_000]],
    ]);
  });

  it('drops intervals shorter than one second', () => {
    const { s, out, t } = setup();
    t.setTask('A');
    t.setFocused(true);
    s.now = 900;
    t.setTask(null);
    expect(out).toEqual([]);
  });
});
