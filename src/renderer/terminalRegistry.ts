import type { Terminal } from '@xterm/xterm';

type Live = Pick<Terminal, 'paste' | 'focus' | 'modes'>;
const live = new Map<string, Live>();

/** TerminalView registers its xterm while mounted, so Send to and links can reach it. */
export function registerTerminal(id: string, t: Live): () => void {
  live.set(id, t);
  return () => {
    if (live.get(id) === t) live.delete(id);
  };
}

/** Pastes as the user would (bracketed when the program asked for it); never sends Enter on its own. */
export function pasteInto(
  id: string,
  text: (bracketed: boolean) => string,
): boolean {
  const t = live.get(id);
  if (!t) return false;
  t.paste(text(Boolean(t.modes.bracketedPasteMode)));
  return true;
}

export function focusTerminal(id: string): void {
  live.get(id)?.focus();
}
