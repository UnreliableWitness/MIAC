import { describe, expect, it } from 'vitest';
import { installFakeApi } from './test-helpers/fakeApi';
import { installWindowChrome } from './windowChrome';

describe('installWindowChrome', () => {
  it('marks the title bar kind and follows full screen', () => {
    const { emit } = installFakeApi();
    const root = document.createElement('div');
    const off = installWindowChrome(
      { ...window.miac!, titleBar: 'inset' },
      root,
    );
    expect(root.dataset.titlebar).toBe('inset');
    expect(root.hasAttribute('data-fullscreen')).toBe(false);
    emit('window:fullScreen', true);
    expect(root.hasAttribute('data-fullscreen')).toBe(true);
    emit('window:fullScreen', false);
    expect(root.hasAttribute('data-fullscreen')).toBe(false);
    off();
    emit('window:fullScreen', true);
    expect(root.hasAttribute('data-fullscreen')).toBe(false);
  });
});
