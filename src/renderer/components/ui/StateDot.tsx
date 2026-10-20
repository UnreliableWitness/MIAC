import { stateMeta, useTypeMeta } from '../../workItemTypes';

/** ADO's default state colors, used until the project's state colors are fetched. Removed is ADO's white, drawn muted so it shows on a light page. */
const STATE_COLOR: Record<string, string> = {
  new: '#b2b2b2',
  active: '#007acc',
  'in progress': '#007acc',
  committed: '#007acc',
  resolved: '#ff9d00',
  done: '#339933',
  closed: '#339933',
  removed: 'var(--muted)',
};

const stateColor = (state: string): string =>
  STATE_COLOR[state.toLowerCase()] ?? '#b2b2b2';

/** A work item state as ADO draws it: a colored dot before the state name, in the project's color when `connectionId` and `type` are given. */
export function StateDot({
  state,
  type,
  connectionId,
  color: givenColor,
}: {
  state: string;
  type?: string | null;
  connectionId?: string | null;
  color?: string | null;
}) {
  const meta = useTypeMeta(connectionId, type);
  const color = givenColor ?? stateMeta(meta, state)?.color;
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
