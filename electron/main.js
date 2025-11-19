const { app, BrowserWindow, session } = require("electron");
const path = require("path");

app.commandLine.appendSwitch("ignore-certificate-errors");
app.commandLine.appendSwitch("allow-insecure-localhost");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const SERVER_URL = "http://192.168.1.3:3000";  // sửa IP máy server

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
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => {
    cb(["media", "display-capture"].includes(perm));
  });

  createMainWindow();
});

app.on("window-all-closed", () => app.quit());
