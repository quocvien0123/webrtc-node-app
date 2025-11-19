// electron/main.js
const { app, BrowserWindow, session } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-insecure-localhost');

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    const allow = ['media', 'display-capture'];
    cb(allow.includes(permission));
  });
});


// Cho phép HTTPS tự ký trong dev
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-insecure-localhost');
// Tránh chặn autoplay audio khi phát remote stream
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 🔧 Đặt IP máy A tại đây (hoặc xuất biến môi trường SERVER_URL)
const SERVER_URL = process.env.SERVER_URL || 'https://192.168.1.3:3000'; // ← đổi 192.168.1.3 thành IP máy A

function createMainWindow() {
  const mainWindow = new BrowserWindow({
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
  mainWindow.on('closed', () => {});
}

app.whenReady().then(() => {
  // Cấp quyền media + share screen
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    const allow = ['media', 'display-capture'];
    cb(allow.includes(permission));
  });

  createMainWindow();
});

app.on('window-all-closed', () => app.quit());
