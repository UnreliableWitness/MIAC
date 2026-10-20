import { gitAuthAdvice, type GitAuthHint } from '../../shared/gitAuth';
import { useStore } from '../store';

const WARN = String.fromCharCode(0x26a0);

/** The Settings section id of a connection's row, which opens its Update token form. */
export const connectionSection = (connectionId: string) =>
  `conn-${connectionId}`;

/** Under a git error that could not sign in: what to do, and Update token when an Azure DevOps token was used. */
export function GitAuthNotice({
  hint,
  command = 'git fetch',
}: {
  hint: GitAuthHint;
  command?: 'git fetch' | 'git push';
}) {
  const go = useStore((s) => s.go);
  const known = useStore((s) =>
    s.connections.some((c) => c.id === hint.connectionId),
  );
  // A connection removed since the failure cannot be updated; the terminal advice still holds.
  const shown = known ? hint : { ...hint, connectionId: null };
  return (
    <div className="check check-warn" role="alert">
      <span aria-hidden="true">{WARN}</span>
      <div className="body">{gitAuthAdvice(shown, command)}</div>
      {shown.connectionId && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            go({
              kind: 'settings',
              section: connectionSection(shown.connectionId as string),
            })
          }
        >
          Update token
        </button>
      )}
    </div>
  );
}
