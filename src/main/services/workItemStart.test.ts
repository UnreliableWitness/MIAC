import { describe, expect, it } from 'vitest';
import { planStartUpdate } from './workItemStart';

const states = [
  { name: 'New', category: 'Proposed' },
  { name: 'Approved', category: 'Proposed' },
  { name: 'Committed', category: 'InProgress' },
  { name: 'In Progress', category: 'InProgress' },
  { name: 'Ready for validation', category: 'Resolved' },
  { name: 'Done', category: 'Completed' },
];
const on = { moveToInProgress: true, assignToMe: true, stateOverrides: {} };
const cur = (state: string, assignedTo: string | null = null) => ({
  type: 'Task',
  state,
  assignedTo,
});

describe('planStartUpdate', () => {
  it('moves a proposed item to the first In Progress state and assigns it', () => {
    expect(planStartUpdate(cur('New'), states, on, 'me@x.com')).toEqual({
      state: 'Committed',
      assignTo: 'me@x.com',
      detail: 'New → Committed, assigned to you',
    });
  });
  it('honours a per-type override that exists', () => {
    const s = { ...on, stateOverrides: { Task: 'In Progress' } };
    expect(planStartUpdate(cur('New', 'Someone'), states, s, 'me').state).toBe(
      'In Progress',
    );
  });
  it('falls back to the default when the override is not a state of the type', () => {
    const s = { ...on, stateOverrides: { Task: 'Doing' } };
    expect(planStartUpdate(cur('New', 'Someone'), states, s, 'me').state).toBe(
      'Committed',
    );
  });
  it('never moves an item that is already in progress or further', () => {
    expect(planStartUpdate(cur('In Progress', 'A'), states, on, 'me')).toEqual({
      state: null,
      assignTo: null,
      detail: 'Already in progress',
    });
    expect(
      planStartUpdate(cur('Ready for validation', 'A'), states, on, 'me')
        .detail,
    ).toBe('No change (Ready for validation)');
    expect(
      planStartUpdate(cur('Done', 'A'), states, on, 'me').state,
    ).toBeNull();
  });
  it('assigns without moving when already in progress and unassigned', () => {
    expect(planStartUpdate(cur('In Progress'), states, on, 'me')).toEqual({
      state: null,
      assignTo: 'me',
      detail: 'Assigned to you',
    });
  });
  it('respects the toggles and a missing user', () => {
    const off = { ...on, moveToInProgress: false, assignToMe: false };
    expect(planStartUpdate(cur('New'), states, off, 'me')).toEqual({
      state: null,
      assignTo: null,
      detail: 'No change',
    });
    expect(planStartUpdate(cur('New'), states, on, null).assignTo).toBeNull();
  });
  it('does not move when the type has no In Progress state', () => {
    const only = [
      { name: 'New', category: 'Proposed' },
      { name: 'Done', category: 'Completed' },
    ];
    expect(planStartUpdate(cur('New', 'A'), only, on, 'me').detail).toBe(
      'No In Progress state for Task',
    );
  });
});
