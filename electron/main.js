// electron/main.js
const { app, BrowserWindow, session } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-insecure-localhost');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const HOST = process.env.HOST || '192.168.1.3';
const PORT = process.env.PORT || '3000';
const SERVER_URL = process.env.SERVER_URL || `https://${HOST}:${PORT}`;

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
  if (process.env.DEVTOOLS === '1') mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['media', 'display-capture'].includes(permission));
  });
  createMainWindow();
});

app.on('window-all-closed', () => app.quit());
