/** ADO's default state colors, used until the project's state colors are fetched. */
const STATE_COLOR: Record<string, string> = {
  new: '#b2b2b2',
  active: '#007acc',
  'in progress': '#007acc',
  committed: '#007acc',
  resolved: '#ff9d00',
  done: '#339933',
  closed: '#339933',
  removed: '#ffffff',
};

export const stateColor = (state: string): string =>
  STATE_COLOR[state.toLowerCase()] ?? '#b2b2b2';

/** A work item state as ADO draws it: a colored dot before the state name. */
export function StateDot({
  state,
  color,
}: {
  state: string;
  color?: string | null;
}) {
  return (
    <span className="state">
      <span
        className="state-dot"
        aria-hidden="true"
        style={{ background: color ?? stateColor(state) }}
      />
      {state}
    </span>
  );
}
