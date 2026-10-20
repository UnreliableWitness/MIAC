import { describe, expect, it } from 'vitest';
import { titleBarKind } from '../shared/titleBar';
import {
  chromeColors,
  splashBackground,
  titleBarOptions,
  windowBackground,
} from './windowChrome';

describe('titleBarOptions', () => {
  it('puts the macOS traffic lights inside the 40 px header, vertically centred', () => {
    for (const scheme of ['dark', 'light'] as const)
      expect(titleBarOptions('darwin', scheme)).toEqual({
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 14, y: 13 },
      });
  });

  it('draws the Windows controls over the header in its colours and height', () => {
    expect(titleBarOptions('win32', 'dark')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#1b1a19', symbolColor: '#e8e8e8', height: 40 },
    });
    expect(titleBarOptions('win32', 'light')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#f3f2f1', symbolColor: '#1b1a19', height: 40 },
    });
  });

  it('keeps the system title bar elsewhere', () => {
    expect(titleBarOptions('linux', 'light')).toEqual({});
  });
});

describe('scheme colours', () => {
  it('matches --bg-chrome / --bg-page of tokens.css per scheme', () => {
    expect(chromeColors('dark')).toEqual({
      color: '#1b1a19',
      symbolColor: '#e8e8e8',
    });
    expect(windowBackground('dark')).toBe('#201f1e');
    expect(windowBackground('light')).toBe('#faf9f8');
    expect(splashBackground('dark')).toBe('#1b1a19');
    expect(splashBackground('light')).toBe('#f3f2f1');
  });
});

describe('titleBarKind', () => {
  it('maps platforms to how the renderer reserves room for the window controls', () => {
    expect(titleBarKind('darwin')).toBe('inset');
    expect(titleBarKind('win32')).toBe('overlay');
    expect(titleBarKind('linux')).toBe('native');
  });
});
