import { describe, expect, it } from 'vitest';
import { ago, compact, dateTime, eur, sprintDates } from './format';

describe('format', () => {
  it('formats euros, token counts and ages', () => {
    expect(eur(23.854)).toBe(`${String.fromCharCode(0x20ac)}23.85`);
    expect([compact(950), compact(412_000), compact(6_812_400)]).toEqual([
      '950',
      '412k',
      '6.8M',
    ]);
    const now = Date.parse('2026-10-14T12:00:00.000Z');
    expect(ago('2026-10-14T11:59:40.000Z', now)).toBe('just now');
    expect(ago('2026-10-14T11:48:00.000Z', now)).toBe('12 min ago');
    expect(ago('2026-10-14T09:00:00.000Z', now)).toBe('3 h ago');
    expect(ago('2026-10-12T12:00:00.000Z', now)).toBe('2 d ago');
  });
  it('formats a local date and time without ISO noise', () => {
    expect(dateTime(new Date(2026, 9, 15, 12, 1).toISOString())).toBe(
      '15 Oct 2026, 12:01',
    );
    expect(dateTime('not a date')).toBe('not a date');
  });
});

describe('sprintDates', () => {
  it('shows day and month of both ends, in UTC', () => {
    expect(sprintDates('2026-10-15T00:00:00Z', '2026-10-28T00:00:00Z')).toBe(
      '15 Oct – 28 Oct',
    );
  });
  it('is null when a date is unset or unreadable', () => {
    expect(sprintDates(null, '2026-10-28T00:00:00Z')).toBeNull();
    expect(sprintDates('2026-10-15T00:00:00Z', null)).toBeNull();
    expect(sprintDates('soon', '2026-10-28T00:00:00Z')).toBeNull();
  });
});
