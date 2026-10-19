import { beforeEach, describe, expect, it } from 'vitest';
import type { AttentionSnapshot } from '../../shared/attention';
import { AttentionTracker } from './AttentionTracker';

let notified: string[];
let dismissed: string[];
let last: AttentionSnapshot;
let onDone: boolean;

const make = () =>
  new AttentionTracker({
    now: () => 1000,
    notifyOnDone: () => onDone,
    onNotify: (id) => notified.push(id),
    onDismiss: (id) => dismissed.push(id),
    onChange: (s) => {
      last = s;
    },
  });

beforeEach(() => {
  notified = [];
  dismissed = [];
  last = {};
  onDone = true;
});

describe('AttentionTracker', () => {
  it('notifies once for a blocked terminal that is not on screen', () => {
    const t = make();
    t.setFocused(true);
    t.setView({ taskId: 'a', tabId: 'other' });
    t.signal('t1', { state: 'blocked', kind: 'permission', message: 'm' });
    expect(notified).toEqual(['t1']);
    expect(last).toEqual({
      t1: { reason: 'blocked', kind: 'permission', message: 'm', since: 1000 },
    });
  });

  it('ignores signals for the terminal on screen', () => {
    const t = make();
    t.setFocused(true);
    t.setView({ taskId: 'a', tabId: 't1' });
    t.signal('t1', { state: 'blocked' });
    expect(notified).toEqual([]);
    expect(t.snapshot()).toEqual({});
  });

  it('counts the active tab of an unfocused window as out of view, and clears on focus', () => {
    const t = make();
    t.setView({ taskId: 'a', tabId: 't1' });
    t.setFocused(false);
    t.signal('t1', { state: 'done' });
    expect(notified).toEqual(['t1']);
    t.setFocused(true);
    expect(t.snapshot()).toEqual({});
    expect(dismissed).toEqual(['t1']);
  });

  it('notifies once until looked at: blocked, working, done, blocked', () => {
    const t = make();
    t.signal('t1', { state: 'blocked' });
    t.signal('t1', { state: 'working' });
    expect(t.snapshot()).toEqual({});
    t.signal('t1', { state: 'done' });
    t.signal('t1', { state: 'blocked' });
    expect(notified).toEqual(['t1']);
    expect(t.snapshot().t1.reason).toBe('blocked');
    t.setFocused(true);
    t.setView({ taskId: 'a', tabId: 't1' });
    t.setView({ taskId: 'a', tabId: 'docs' });
    t.signal('t1', { state: 'blocked' });
    expect(notified).toEqual(['t1', 't1']);
  });

  it('with notifyOnDone off, done only clears', () => {
    onDone = false;
    const t = make();
    t.signal('t1', { state: 'blocked' });
    t.signal('t1', { state: 'done' });
    expect(t.snapshot()).toEqual({});
    expect(notified).toEqual(['t1']);
  });

  it('idle and clear clear the entry and dismiss the notification', () => {
    const t = make();
    t.signal('t1', { state: 'blocked' });
    t.signal('t1', { state: 'idle' });
    expect(t.snapshot()).toEqual({});
    expect(dismissed).toEqual(['t1']);
  });

  it('forget and retain drop terminals', () => {
    const t = make();
    t.signal('t1', { state: 'blocked' });
    t.signal('t2', { state: 'blocked' });
    t.retain(new Set(['t2']));
    expect(Object.keys(t.snapshot())).toEqual(['t2']);
    t.forget('t2');
    expect(t.snapshot()).toEqual({});
    expect(dismissed).toEqual(['t1', 't2']);
  });
});
