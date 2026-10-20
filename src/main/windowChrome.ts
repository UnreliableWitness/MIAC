import type { BrowserWindowConstructorOptions } from 'electron';
import type { ColorScheme } from '../shared/theme';
import { TITLE_BAR_HEIGHT, titleBarKind } from '../shared/titleBar';

/** `--bg-chrome` and `--text` (on that ground) from tokens.css, so the Windows buttons blend into the header. */
const CHROME: Record<ColorScheme, { color: string; symbolColor: string }> = {
  dark: { color: '#1b1a19', symbolColor: '#e8e8e8' },
  light: { color: '#f3f2f1', symbolColor: '#1b1a19' },
};
/** `--bg-page` from tokens.css: the window's colour before the page paints. */
const PAGE: Record<ColorScheme, string> = { dark: '#201f1e', light: '#faf9f8' };

export const chromeColors = (scheme: ColorScheme) => CHROME[scheme];
export const windowBackground = (scheme: ColorScheme) => PAGE[scheme];
/** The splash is drawn on the chrome colour. */
export const splashBackground = (scheme: ColorScheme) => CHROME[scheme].color;
/** macOS traffic lights are 14 px tall; centred in the header, 14 px from the left edge. */
const TRAFFIC_LIGHT_SIZE = 14;

/** Main window options that hide the system title bar so the app header is the only bar (#49). */
export function titleBarOptions(
  platform: NodeJS.Platform,
  scheme: ColorScheme,
): Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'titleBarOverlay' | 'trafficLightPosition'
> {
  switch (titleBarKind(platform)) {
    case 'inset':
      return {
        titleBarStyle: 'hidden',
        trafficLightPosition: {
          x: 14,
          y: Math.round((TITLE_BAR_HEIGHT - TRAFFIC_LIGHT_SIZE) / 2),
        },
      };
    case 'overlay':
      return {
        titleBarStyle: 'hidden',
        titleBarOverlay: { ...chromeColors(scheme), height: TITLE_BAR_HEIGHT },
      };
    case 'native':
      return {};
  }
}
