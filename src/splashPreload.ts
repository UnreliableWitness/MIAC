import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('splash', {
  onStep: (fn: (label: string) => void) =>
    ipcRenderer.on('splash:step', (_e, l: string) => fn(l)),
  onFail: (fn: (message: string) => void) =>
    ipcRenderer.on('splash:fail', (_e, m: string) => fn(m)),
  onDone: (fn: () => void) => ipcRenderer.on('splash:done', () => fn()),
  skip: () => ipcRenderer.send('splash:skip'),
  quit: () => ipcRenderer.send('splash:quit'),
});
