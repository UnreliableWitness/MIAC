import type { ColorScheme } from '../shared/theme';

const QUERY = '(prefers-color-scheme: light)';
let scheme: ColorScheme = 'dark';
const listeners = new Set<() => void>();

/** A matchMedia that answers the light-scheme query from `scheme`; every other query is false. */
export function installMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === QUERY && scheme === 'light';
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    addListener: (l: () => void) => listeners.add(l),
    removeListener: (l: () => void) => listeners.delete(l),
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}

/** Switches the emulated OS appearance and fires the change listeners. */
export function setTestColorScheme(next: ColorScheme): void {
  scheme = next;
  for (const l of Array.from(listeners)) l();
}

export function resetTestColorScheme(): void {
  scheme = 'dark';
  listeners.clear();
}
