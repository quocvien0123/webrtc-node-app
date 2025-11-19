// electron/main.js
const { app, BrowserWindow, session } = require('electron');
const path = require('path');

// Cho phép HTTPS self-signed + autoplay
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-insecure-localhost');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 🔧 ĐẶT IP MÁY CHẠY SERVER TẠI ĐÂY
const SERVER_URL = process.env.SERVER_URL || 'https://192.168.1.3:3000';

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#050816',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(SERVER_URL);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Cho phép camera/mic + share màn hình
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    const allow = ['media', 'display-capture'];
    cb(allow.includes(permission));
  });

  createMainWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
