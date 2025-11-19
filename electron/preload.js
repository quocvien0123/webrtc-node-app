// electron/preload.js
const { contextBridge } = require('electron');

let dc;
try {
  dc = require('electron').desktopCapturer;
} catch (_) {
  // ignore
}

contextBridge.exposeInMainWorld('electronAPI', {
  desktopCapturerAvailable: !!(dc && typeof dc.getSources === 'function'),

  async getDesktopSources(opts = { types: ['screen', 'window'], thumbnailSize: { width: 400, height: 250 } }) {
    if (!dc || typeof dc.getSources !== 'function') {
      throw new Error('desktopCapturer unavailable (check Electron version/preload)');
    }
    const sources = await dc.getSources(opts);
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : null,
    }));
  },
});
