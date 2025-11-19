// electron/preload.js
const { contextBridge } = require("electron");

// Hỗ trợ cả Electron 25 lẫn các bản mới (28+)
let desktopCapturer = null;

try {
  // Electron <=27
  desktopCapturer = require("electron").desktopCapturer;
} catch (e1) {
  try {
    // Electron 28+ (không dùng trong case này, nhưng cho chắc)
    desktopCapturer = require("electron/main").desktopCapturer;
  } catch (e2) {
    desktopCapturer = null;
  }
}

const hasDesktopCapturer =
  !!desktopCapturer && typeof desktopCapturer.getSources === "function";

contextBridge.exposeInMainWorld("electronAPI", {
  desktopCapturerAvailable: hasDesktopCapturer,
  version: process.versions.electron,
  debugInfo() {
    return {
      hasDesktopCapturer,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
    };
  },

  async getDesktopSources(opts = { types: ["screen", "window"], thumbnailSize: { width: 400, height: 250 } }) {
    if (!hasDesktopCapturer) {
      throw new Error("desktopCapturer not available (check Electron version / preload.js)");
    }
    const sources = await desktopCapturer.getSources(opts);
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : null,
    }));
  },
});

// Log ra console của preload (có thể xem trong devtools: console của renderer) để xác nhận
try {
  console.log('[preload] electronVersion=', process.versions.electron, 'desktopCapturerAvailable=', hasDesktopCapturer);
} catch {}
