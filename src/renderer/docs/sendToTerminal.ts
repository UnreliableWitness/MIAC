import type { TerminalDef } from '../../shared/types';
import { api } from '../api';
import { useStore } from '../store';
import { focusTerminal, pasteInto } from '../terminalRegistry';
import { writeSendTarget } from './docsPrefs';

/** The terminal last sent to, else the first preferred one, else the first. */
export function pickSendTarget(
  terminals: TerminalDef[],
  chosen: string | null,
  preferred: (t: TerminalDef) => boolean,
): TerminalDef | undefined {
  return (
    terminals.find((t) => t.id === chosen) ??
    terminals.find(preferred) ??
    terminals[0]
  );
}

/**
 * Pastes text into a running, open terminal and remembers it as the task's send target.
 * Warns as `${who} is not running/open` and returns false when it cannot.
 */
export async function pasteToTerminal({
  taskId,
  id,
  who,
  text,
  notify,
  onChosen,
}: {
  taskId: string;
  id: string;
  who: string;
  text: (bracketed: boolean) => string;
  notify: (level: 'warn', message: string) => void;
  onChosen: (id: string) => void;
}): Promise<boolean> {
  let running = false;
  try {
    running = Boolean(await api().invoke('terminals:isRunning', id));
  } catch {
    running = false;
  }
  if (!running) {
    notify('warn', `${who} is not running`);
    return false;
  }
  if (!pasteInto(id, text)) {
    notify('warn', `${who} is not open`);
    return false;
  }
  writeSendTarget(taskId, id);
  onChosen(id);
  return true;
}

/** Switches to the terminal's tab and focuses it once it is shown. */
export function showTerminal(taskId: string, id: string): void {
  useStore.getState().setTab(taskId, id);
  requestAnimationFrame(() => focusTerminal(id));
}
