import { contextBridge, ipcRenderer } from 'electron';
import { EVENT_PREFIX, type MiacApi } from './shared/ipc';
import { TELEMETRY_CHANNEL } from './shared/telemetry';

const api: MiacApi = {
  invoke: async (channel, ...args) => {
    try {
      return await ipcRenderer.invoke(channel, ...args);
    } catch (e) {
      // Electron wraps handler errors as "Error invoking remote method 'x': Error: <message>"; hand the renderer the plain message.
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(
        message.replace(
          /^Error invoking remote method '[^']+': (?:Error: )?/,
          '',
        ),
      );
    }
  },
  on: (event, listener) => {
    const channel = `${EVENT_PREFIX}${event}`;
    const wrapped = (_e: Electron.IpcRendererEvent, payload: unknown) =>
      listener(payload as never);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  track: (message) => ipcRenderer.send(TELEMETRY_CHANNEL, message),
};

contextBridge.exposeInMainWorld('miac', api);
