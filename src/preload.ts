import { contextBridge, ipcRenderer } from 'electron';
import { EVENT_PREFIX, type MiacApi } from './shared/ipc';

const api: MiacApi = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (event, listener) => {
    const channel = `${EVENT_PREFIX}${event}`;
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) =>
      listener(payload as never);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld('miac', api);
