// Electron 45 sandbox: no Node globals, module shims or transitive runtime dependencies.
import { contextBridge, ipcRenderer } from 'electron';
import type { FolderSnapshot, VisorBridge } from './contracts';
const bridge: VisorBridge = {
  chooseFolder: () => ipcRenderer.invoke('visor:chooseFolder'),
  getSnapshot: () => ipcRenderer.invoke('visor:getSnapshot'),
  readNote: (id, generation) => ipcRenderer.invoke('visor:readNote', id, generation),
  openExternal: url => ipcRenderer.invoke('visor:openExternal', url),
  onUpdate(callback) {
    if (typeof callback !== 'function') throw new TypeError('Callback required');
    const listener = (_event: unknown, snapshot: FolderSnapshot) => callback(snapshot);
    ipcRenderer.on('visor:update', listener);
    return () => ipcRenderer.removeListener('visor:update', listener);
  }
};
contextBridge.exposeInMainWorld('visor', bridge);
