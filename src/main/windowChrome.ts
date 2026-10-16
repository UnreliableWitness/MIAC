import type { BrowserWindowConstructorOptions } from 'electron';
import { TITLE_BAR_HEIGHT, titleBarKind } from '../shared/titleBar';

/** `--bg-chrome` and `--text` (on that ground) from tokens.css, so the Windows buttons blend into the header. */
const CHROME_BG = '#1b1a19';
const CHROME_SYMBOL = '#e8e8e8';
/** macOS traffic lights are 14 px tall; centred in the header, 14 px from the left edge. */
const TRAFFIC_LIGHT_SIZE = 14;

/** Main window options that hide the system title bar so the app header is the only bar (#49). */
export function titleBarOptions(
  platform: NodeJS.Platform,
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
        titleBarOverlay: {
          color: CHROME_BG,
          symbolColor: CHROME_SYMBOL,
          height: TITLE_BAR_HEIGHT,
        },
      };
    case 'native':
      return {};
  }
}
