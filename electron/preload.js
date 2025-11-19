// electron/preload.js
const { contextBridge, desktopCapturer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Trả về mảng { id, name, thumbnail } serializable
  async getDesktopSources(opts) {
    const sources = await desktopCapturer.getSources(opts);
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : null,
    }));
  },
});
