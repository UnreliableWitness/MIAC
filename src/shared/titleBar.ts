/**
 * How the window's title bar is drawn (#49). The app header doubles as the title bar:
 * - `inset`: macOS, the traffic lights sit inside the header on its left.
 * - `overlay`: Windows, the native minimise/maximise/close buttons are drawn over the header's right end.
 * - `native`: anything else keeps the system title bar above the app.
 */
export type TitleBarKind = 'inset' | 'overlay' | 'native';

/** The app header's height in px; the Windows control overlay and the traffic lights are sized to it. */
export const TITLE_BAR_HEIGHT = 40;

export function titleBarKind(platform: NodeJS.Platform): TitleBarKind {
  if (platform === 'darwin') return 'inset';
  if (platform === 'win32') return 'overlay';
  return 'native';
}
