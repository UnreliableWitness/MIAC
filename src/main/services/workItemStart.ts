/** What starting a task changes on its work item. Pure: the caller reads the item and its states, and writes the plan. */

import type { StartSettings } from '../../shared/types';

export type { StartSettings };
export type StartCurrent = {
  type: string;
  state: string;
  assignedTo: string | null;
};
export type StartPlan = {
  state: string | null;
  assignTo: string | null;
  detail: string;
};

const ARROW = String.fromCharCode(0x2192);

export function planStartUpdate(
  current: StartCurrent,
  states: { name: string; category: string | null }[],
  settings: StartSettings,
  user: string | null,
): StartPlan {
  const category =
    states.find((s) => s.name === current.state)?.category ?? null;
  const assignTo =
    settings.assignToMe && user && !current.assignedTo ? user : null;
  let state: string | null = null;
  let note: string | null = null;
  if (settings.moveToInProgress) {
    if (category === 'Proposed') {
      const override = settings.stateOverrides[current.type];
      const target =
        (override &&
          states.find(
            (s) => s.name === override && s.category === 'InProgress',
          )) ||
        states.find((s) => s.category === 'InProgress');
      if (target) state = target.name;
      else note = `No In Progress state for ${current.type}`;
    } else if (category === 'InProgress') note = 'Already in progress';
    else note = `No change (${current.state})`;
  }
  const parts: string[] = [];
  if (state) parts.push(`${current.state} ${ARROW} ${state}`);
  if (assignTo)
    parts.push(parts.length ? 'assigned to you' : 'Assigned to you');
  const detail = parts.length ? parts.join(', ') : (note ?? 'No change');
  return { state, assignTo, detail };
}
