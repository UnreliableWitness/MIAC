import { describe, expect, it } from 'vitest';
import { periodRange, stateCategory } from './home';

describe('periodRange', () => {
  it('week starts Monday 00:00 local time', () => {
    const now = new Date(2026, 9, 19, 10, 0); // Monday 19 Oct 2026
    expect(new Date(periodRange('week', now).from)).toEqual(
      new Date(2026, 9, 19, 0, 0),
    );
    const sunday = new Date(2026, 9, 18, 23, 30);
    expect(new Date(periodRange('week', sunday).from)).toEqual(
      new Date(2026, 9, 12, 0, 0),
    );
  });
  it('month starts on the 1st', () => {
    const now = new Date(2026, 9, 17, 8, 0);
    expect(new Date(periodRange('month', now).from)).toEqual(
      new Date(2026, 9, 1, 0, 0),
    );
    expect(periodRange('month', now).to).toBe(now.getTime());
  });
});

describe('stateCategory', () => {
  it('uses the metadata category when known', () => {
    expect(stateCategory('Completed', 'Shipped')).toBe('Completed');
  });
  it('guesses from the name without metadata', () => {
    expect(stateCategory(undefined, 'To Do')).toBe('Proposed');
    expect(stateCategory(null, 'Done')).toBe('Completed');
    expect(stateCategory(undefined, 'Doing')).toBe('InProgress');
  });
  it('treats Resolved as in progress', () => {
    expect(stateCategory('Resolved', 'Resolved')).toBe('InProgress');
  });
});
