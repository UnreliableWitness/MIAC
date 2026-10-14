/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';
declare module '*.png?inline' {
  const src: string;
  export default src;
}

interface Window {
  miac: import('./shared/ipc').MiacApi;
}

// Forge's env types declare only MAIN_WINDOW_*; the splash renderer gets its own pair.
declare const SPLASH_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const SPLASH_WINDOW_VITE_NAME: string;
