const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const https = require('https');
const net = require('net');

let mainWindow;
let serverProcess = null;

// Allow ignoring self-signed certs in development so Electron can load the
// local HTTPS server. Keep this only for dev — remove for production.
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('allow-insecure-localhost');

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

  // Try to detect a reachable server. Try HTTPS first, then HTTP as fallback.
  const tryUrls = ['https://192.168.1.3:3000', 'http://192.168.1.3:3000'];
  waitForAnyServerReady(tryUrls, 500, 20000)
    .then((url) => {
      console.log('Loading', url);
      mainWindow.loadURL(url);
    })
    .catch((err) => {
      console.error('Server not ready, loading local file as fallback:', err);
      mainWindow.loadFile(path.join(__dirname, '..', 'public', 'index.html'));
    });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function spawnServer() {
  try {
    const nodeExecutable = process.execPath;
    const serverPath = path.join(__dirname, '..', 'server.js');
    serverProcess = spawn(nodeExecutable, [serverPath], { stdio: 'inherit' });

    serverProcess.on('error', (err) => {
      console.error('Failed to start server process:', err);
    });
  } catch (err) {
    console.error('Error while spawning server:', err);
  }
}

function waitForServerReady(url, interval = 500, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ rejectUnauthorized: false });
    const start = Date.now();

    const check = () => {
      const isHttps = url.startsWith('https://');
      const reqFn = isHttps ? https.get : require('http').get;
      const opts = isHttps ? { agent } : {};
      const req = reqFn(url, opts, (res) => {
        res.resume();
        resolve(url);
      });
      req.on('error', (err) => {
        if (Date.now() - start > timeout) {
          reject(err);
        } else {
          setTimeout(check, interval);
        }
      });
      req.setTimeout(interval, () => {
        req.abort();
      });
    };

    check();
  });
}

function waitForAnyServerReady(urls, interval = 500, timeout = 20000) {
  // Try urls in sequence until one responds
  let i = 0;
  return new Promise((resolve, reject) => {
    const tryNext = () => {
      if (i >= urls.length) return reject(new Error('No server ready'));
      waitForServerReady(urls[i], interval, timeout)
        .then((url) => resolve(url))
        .catch(() => {
          i += 1;
          tryNext();
        });
    };
    tryNext();
  });
}

app.whenReady().then(async () => {
  // Only spawn the bundled server when START_SERVER=1 to avoid accidental
  // spawning on client machines. This lets you run Electron as client-only on
  // other devices without creating a local server.
  const shouldStartServer = process.env.START_SERVER === '1';
  if (shouldStartServer) {
    // If a server is already listening on the target host:port, don't spawn another.
    const targetUrl = 'https://192.168.1.3:3000';
    const { hostname, port } = new URL(targetUrl);

    try {
      const inUse = await isPortInUse(hostname, port, 1000);
      if (inUse) {
        console.log(`${hostname}:${port} is already in use — skipping spawn.`);
      } else {
        spawnServer();
      }
    } catch (err) {
      console.error('Error while checking port:', err);
      // fallback: try to spawn anyway
      spawnServer();
    }
  } else {
    console.log('START_SERVER not set — not spawning server from Electron.');
  }

  createMainWindow();
});

function isPortInUse(host, port, timeout = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let called = false;

    socket.setTimeout(timeout);
    socket.once('connect', () => {
      called = true;
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      if (!called) {
        called = true;
        socket.destroy();
        resolve(false);
      }
    });
    socket.once('error', () => {
      if (!called) {
        called = true;
        socket.destroy();
        resolve(false);
      }
    });
    socket.connect(port, host);
  });
}

app.on('activate', () => {
  if (mainWindow === null) createMainWindow();
});

app.on('will-quit', () => {
  if (serverProcess && !serverProcess.killed) {
    try {
      serverProcess.kill();
    } catch (e) {
      // ignore
    }
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
