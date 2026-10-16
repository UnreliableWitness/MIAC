import { describe, expect, it } from 'vitest';
import { titleBarKind } from '../shared/titleBar';
import { titleBarOptions } from './windowChrome';

describe('titleBarOptions', () => {
  it('puts the macOS traffic lights inside the 40 px header, vertically centred', () => {
    expect(titleBarOptions('darwin')).toEqual({
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 14, y: 13 },
    });
  });

  it('draws the Windows controls over the header in its colours and height', () => {
    expect(titleBarOptions('win32')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#1b1a19', symbolColor: '#e8e8e8', height: 40 },
    });
  });

  it('keeps the system title bar elsewhere', () => {
    expect(titleBarOptions('linux')).toEqual({});
  });
});

describe('titleBarKind', () => {
  it('maps platforms to how the renderer reserves room for the window controls', () => {
    expect(titleBarKind('darwin')).toBe('inset');
    expect(titleBarKind('win32')).toBe('overlay');
    expect(titleBarKind('linux')).toBe('native');
  });
});
