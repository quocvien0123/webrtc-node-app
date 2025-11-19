// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  version: process.versions.electron,
  desktopCapturerAvailable: true, // sẽ kiểm tra thực tế qua IPC
  async getDesktopSources(opts) {
    const sources = await ipcRenderer.invoke('desktop-sources', opts);
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : null,
    }));
  },
  debugInfo() {
    return {
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      ipcAvailable: true,
    };
  }
});

try {
  console.log('[preload] electronVersion=', process.versions.electron, 'IPC desktop-sources ready');
} catch {}
