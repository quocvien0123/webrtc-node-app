const { app, BrowserWindow, session } = require("electron");
const path = require("path");

app.commandLine.appendSwitch("ignore-certificate-errors");
app.commandLine.appendSwitch("allow-insecure-localhost");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// Cho phép HTTP LAN coi như an toàn để dùng getUserMedia trong dev
const INSECURE_ORIGIN = process.env.INSECURE_ORIGIN || "http://192.168.1.3:3000";
app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', INSECURE_ORIGIN);

// Ưu tiên HTTPS nếu bật USE_HTTPS, ngược lại dùng HTTP
const SERVER_URL = process.env.SERVER_URL || INSECURE_ORIGIN; // chỉnh IP qua env

let mainWindow;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadURL(SERVER_URL);
  // Mở devtools tùy chọn
  if (process.env.DEVTOOLS === '1') mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => {
    cb(["media", "display-capture"].includes(perm));
  });

  createMainWindow();
});

app.on("window-all-closed", () => app.quit());
