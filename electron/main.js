// electron/main.js
const { app, BrowserWindow, session } = require('electron');
const path = require('path');

// Command-line switches for dev (self-signed certs, autoplay)
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-insecure-localhost');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 🔧 Đặt URL server (hoặc qua env SERVER_URL)
const SERVER_URL = process.env.SERVER_URL || 'https://192.168.1.3:3000';

let mainWindow = null;

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(SERVER_URL);
}

app.whenReady().then(() => {
  // ✅ BẮT BUỘC: cấp quyền cho camera/mic + share màn hình
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    const allow = ['media', 'display-capture'];
    cb(allow.includes(permission));
  });

  createMainWindow();
});

app.on('window-all-closed', () => app.quit());