const { contextBridge } = require("electron");
const { desktopCapturer } = require("electron/main");

contextBridge.exposeInMainWorld("electronAPI", {
  desktopCapturerAvailable: true,

  async getDesktopSources(opts) {
    const sources = await desktopCapturer.getSources(opts);
    return sources.map((src) => ({
      id: src.id,
      name: src.name,
      thumbnail: src.thumbnail ? src.thumbnail.toDataURL() : null
    }));
  }
});
