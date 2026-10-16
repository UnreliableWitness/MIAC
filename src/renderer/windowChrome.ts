import type { MiacApi } from '../shared/ipc';

/**
 * Marks the document with how the window draws its title bar (`data-titlebar`) and whether it is full screen
 * (`data-fullscreen`), so shell.css keeps the header clear of the window controls (#49). Returns the unsubscribe.
 */
export function installWindowChrome(
  miac: Pick<MiacApi, 'titleBar' | 'on'>,
  root: HTMLElement = document.documentElement,
): () => void {
  root.dataset.titlebar = miac.titleBar;
  return miac.on('window:fullScreen', (fullScreen) => {
    if (fullScreen) root.dataset.fullscreen = '';
    else delete root.dataset.fullscreen;
  });
}
