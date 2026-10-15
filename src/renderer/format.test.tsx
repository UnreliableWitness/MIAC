import { describe, expect, it } from 'vitest';
import { ago, compact, dateTime, duration, eur, sprintDates } from './format';

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

describe('duration', () => {
  const at = (min: number) =>
    new Date(Date.parse('2026-10-15T08:00:00Z') + min * 60_000).toISOString();
  const from = at(0);
  it('uses minutes under an hour', () => {
    expect(duration(from, at(45))).toBe('45 min');
    expect(duration(from, at(0.2))).toBe('under 1 min');
  });
  it('uses hours and minutes under a day', () => {
    expect(duration(from, at(185))).toBe('3 h 5 min');
    expect(duration(from, at(120))).toBe('2 h');
  });
  it('uses days and hours from a day on', () => {
    expect(duration(from, at((2 * 24 + 3) * 60 + 20))).toBe('2 d 3 h');
    expect(duration(from, at(24 * 60))).toBe('1 d');
  });
  it('is null for a bad or reversed range', () => {
    expect(duration(at(10), from)).toBeNull();
    expect(duration('x', from)).toBeNull();
  });
});
