// electron/main.js
const { app, BrowserWindow, session, ipcMain, desktopCapturer } = require("electron");
const path = require("path");

// Bỏ qua cert tự ký + cho autoplay
app.commandLine.appendSwitch("ignore-certificate-errors");
app.commandLine.appendSwitch("allow-insecure-localhost");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// 🔧 ĐẶT IP MÁY CHẠY SERVER Ở ĐÂY
const HOST = process.env.HOST || "192.168.1.3"; // ĐỔI thành IP máy A
const PORT = process.env.PORT || "3000";
const SERVER_URL = process.env.SERVER_URL || `https://${HOST}:${PORT}`;

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.loadURL(SERVER_URL);

  if (process.env.DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools();
  }
  console.log('[main] SERVER_URL=', SERVER_URL);
}

app.whenReady().then(() => {
  // Cho phép camera/mic + share màn hình
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(["media", "display-capture"].includes(permission));
  });

  // IPC lấy sources màn hình
  ipcMain.handle('desktop-sources', async (event, opts) => {
    try {
      return await desktopCapturer.getSources(opts || { types: ['screen','window'], thumbnailSize: { width: 400, height: 250 } });
    } catch (e) {
      console.error('[IPC] desktop-sources error', e);
      throw e;
    }
  });

  createMainWindow();
});

app.on("window-all-closed", () => app.quit());
