/** What the developer picks in Settings → Appearance; `system` follows the OS appearance. */
export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEMES)[number];
/** The look actually on screen. */
export type ColorScheme = 'light' | 'dark';

export const schemeOf = (dark: boolean): ColorScheme =>
  dark ? 'dark' : 'light';
