/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
declare module '*.css';

interface Window {
  miac: import('./shared/ipc').MiacApi;
}
