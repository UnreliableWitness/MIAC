import { describe, expect, it } from 'vitest';
import { COMPLETED_WORK, REMAINING_WORK, planTimeWrite } from './timeWriteBack';

const BOTH = [COMPLETED_WORK, REMAINING_WORK, 'System.Title'];

describe('planTimeWrite', () => {
  it('rounds to a quarter hour, adds to Completed and takes from Remaining', () => {
    expect(
      planTimeWrite({
        bookedSeconds: 11400,
        writtenHours: 0,
        current: { remainingWork: 5, completedWork: 0 },
        fields: BOTH,
      }),
    ).toEqual({
      hours: 3.25,
      patch: { [COMPLETED_WORK]: 3.25, [REMAINING_WORK]: 1.75 },
    });
  });

  it('negative delta gives time back', () => {
    expect(
      planTimeWrite({
        bookedSeconds: 7200,
        writtenHours: 3.25,
        current: { remainingWork: 1.75, completedWork: 3.25 },
        fields: BOTH,
      }),
    ).toEqual({
      hours: 2,
      patch: { [COMPLETED_WORK]: 2, [REMAINING_WORK]: 3 },
    });
  });

  it('never takes Remaining Work below 0, and treats unset fields as 0', () => {
    expect(
      planTimeWrite({
        bookedSeconds: 4 * 3600,
        writtenHours: 0,
        current: { remainingWork: 1, completedWork: null },
        fields: BOTH,
      })?.patch,
    ).toEqual({ [COMPLETED_WORK]: 4, [REMAINING_WORK]: 0 });
    expect(
      planTimeWrite({
        bookedSeconds: 3600,
        writtenHours: 0,
        current: { remainingWork: null, completedWork: null },
        fields: BOTH,
      })?.patch,
    ).toEqual({ [COMPLETED_WORK]: 1, [REMAINING_WORK]: 0 });
  });

  it('writes only the fields the type has', () => {
    expect(
      planTimeWrite({
        bookedSeconds: 3600,
        writtenHours: 0,
        current: { remainingWork: 5, completedWork: 2 },
        fields: [COMPLETED_WORK],
      }),
    ).toEqual({ hours: 1, patch: { [COMPLETED_WORK]: 3 } });
  });

  it('is null when the type has neither field', () => {
    expect(
      planTimeWrite({
        bookedSeconds: 3600,
        writtenHours: 0,
        current: { remainingWork: null, completedWork: null },
        fields: ['System.Title'],
      }),
    ).toBeNull();
  });

  it('is null when the rounded hours were already written', () => {
    expect(
      planTimeWrite({
        bookedSeconds: 7300,
        writtenHours: 2,
        current: { remainingWork: 3, completedWork: 2 },
        fields: BOTH,
      }),
    ).toBeNull();
  });
});
