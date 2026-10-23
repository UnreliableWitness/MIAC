import { Dismiss12Regular, Warning16Filled } from '@fluentui/react-icons';
import { Fragment, useState } from 'react';
import type { LeakState } from '../../../shared/secrets';

/** `[A]`, `[A] and [B]`, `[A], [B] and [C]`, each as code. */
function Names({ names }: { names: string[] }) {
  return (
    <>
      {names.map((n, i) => (
        <Fragment key={n}>
          {i > 0 && (i === names.length - 1 ? ' and ' : ', ')}
          <code className="leak-name">{`[${n}]`}</code>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Leak watch in an agent tab: which stored values showed up (hidden on screen as `[NAME]`), honest that the model
 * has read them; and while input is paused after a Production value, a bar with Resume and Stop.
 */
export function LeakNotice({
  state,
  onResume,
  onStop,
  onOpenSecrets,
}: {
  state: LeakState | null;
  onResume: () => void;
  onStop: () => void;
  onOpenSecrets: () => void;
}) {
  const [why, setWhy] = useState(false);
  /** How many names were shown when the notice was dismissed: a new name brings it back. */
  const [dismissedAt, setDismissedAt] = useState(0);
  if (!state || state.names.length === 0) return null;
  const many = state.names.length > 1;
  return (
    <div className="leak">
      {state.paused && (
        <div role="alert" className="leak-paused">
          <Warning16Filled aria-hidden="true" />
          <span className="leak-paused-text">
            <strong>A Production secret appeared.</strong> Input to this tab is
            paused. The model has read the value: rotate the key.
          </span>
          <button type="button" className="btn btn-sm" onClick={onResume}>
            Resume
          </button>
          <button type="button" className="btn btn-sm" onClick={onStop}>
            Stop
          </button>
        </div>
      )}
      {state.names.length > dismissedAt && (
        <div role="status" className="leak-notice">
          <Warning16Filled aria-hidden="true" className="leak-icon" />
          <div className="leak-body">
            <p className="leak-text">
              <strong>
                {many
                  ? 'Secret values showed up in this tab.'
                  : 'A secret value showed up in this tab.'}
              </strong>
              {` Shellie hid ${many ? 'them' : 'it'} on screen as `}
              <Names names={state.names} />
              {`. The model already read ${many ? 'them' : 'it'} in the response — rotate the ${many ? 'keys' : 'key'} if this session leaves your machine.`}
            </p>
            {why && (
              <p className="leak-why muted">
                Shellie sees an agent&apos;s output only after the model wrote
                it: the value came back to the model in a tool&apos;s result (a
                file, a command&apos;s output, a response) and the model read it
                there. Shellie hides it on screen and in this tab&apos;s
                scrollback; it cannot take it back from the model or from the
                provider&apos;s logs.
              </p>
            )}
            <div className="leak-actions">
              <button
                type="button"
                className="btn btn-sm"
                onClick={onOpenSecrets}
              >
                Open Secrets
              </button>
              <button
                type="button"
                className="link"
                aria-expanded={why}
                onClick={() => setWhy((w) => !w)}
              >
                Why this happens
              </button>
            </div>
          </div>
          <button
            type="button"
            className="ibtn"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => setDismissedAt(state.names.length)}
          >
            <Dismiss12Regular aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
