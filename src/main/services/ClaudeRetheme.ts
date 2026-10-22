import type { AttentionState } from '../../shared/attention';
import type { ColorScheme } from '../../shared/theme';

/** How long Claude Code's output has to be still before its tab counts as idle. */
export const QUIET_MS = 2000;

type Tab = {
  /** The scheme of the theme variant the tab started with. */
  scheme: ColorScheme;
  /** Claude Code's last program status (OSC 7501). */
  state?: AttentionState;
  lastOutput: number;
  /** Something was typed or pasted since the last Enter, so the prompt box may hold text a restart would lose. */
  typed: boolean;
};

// eslint-disable-next-line no-control-regex -- matching escape sequences is the point
const ESCAPES = /\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1bO.|\x1b/g;

/**
 * Whether the prompt box may hold unsent text after the developer's input `data`: Enter sends it, Ctrl+C clears
 * it, any other printable character (typed, pasted, or a Send to) adds to it. Keys and focus reports change nothing.
 */
export function unsentAfter(typed: boolean, data: string): boolean {
  let t = typed;
  for (const ch of data.replace(ESCAPES, '')) {
    if (ch === '\r' || ch === '\x03') t = false;
    else if (ch >= ' ' && ch !== '\x7f') t = true;
  }
  return t;
}

/**
 * Claude Code tabs whose theme is fixed to a scheme (colour-blind and ANSI-only themes have no `auto`) keep their
 * palette until they start again, so a switch to dark left a light-daltonized prompt bar on the dark terminal
 * (#105). After a scheme change each such tab is resumed in the new variant, once Claude Code waits for the
 * developer: not working or blocked, output quiet, and nothing typed since the last Enter.
 */
export class ClaudeRetheme {
  private readonly tabs = new Map<string, Tab>();

  constructor(
    private readonly d: {
      now: () => number;
      scheme: () => ColorScheme;
      alive: (id: string) => boolean;
      restart: (id: string) => void;
      quietMs?: number;
    },
  ) {}

  /** A Claude Code tab started with a theme fixed to `scheme`, or one that follows the terminal (null). */
  spawned(id: string, scheme: ColorScheme | null): void {
    if (scheme)
      this.tabs.set(id, { scheme, lastOutput: this.d.now(), typed: false });
    else this.tabs.delete(id);
  }

  output(id: string): void {
    const t = this.tabs.get(id);
    if (t) t.lastOutput = this.d.now();
  }

  status(id: string, state: AttentionState): void {
    const t = this.tabs.get(id);
    if (t) t.state = state;
  }

  input(id: string, data: string): void {
    const t = this.tabs.get(id);
    if (t) t.typed = unsentAfter(t.typed, data);
  }

  exit(id: string): void {
    this.tabs.delete(id);
  }

  /** Resumes every idle tab whose palette is for the other scheme. Runs on a timer and on a scheme change. */
  tick(): void {
    const scheme = this.d.scheme();
    const quiet = this.d.quietMs ?? QUIET_MS;
    for (const [id, t] of this.tabs) {
      if (!this.d.alive(id)) {
        this.tabs.delete(id);
        continue;
      }
      if (t.scheme === scheme) continue;
      if (t.state === 'working' || t.state === 'blocked' || t.typed) continue;
      if (this.d.now() - t.lastOutput < quiet) continue;
      // The restart registers the tab again, with the new scheme.
      this.tabs.delete(id);
      this.d.restart(id);
    }
  }
}
