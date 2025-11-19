// electron/preload.js
const { contextBridge, desktopCapturer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  desktopCapturerAvailable: true,
  async getDesktopSources(opts = { types: ['screen', 'window'], thumbnailSize: { width: 400, height: 250 } }) {
    const sources = await desktopCapturer.getSources(opts);
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : null,
    }));
  },
});
