// server.js
const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const app = express();

// --- Simple file logger ---------------------------------------------------
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'activity.log');
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (e) {
  // ignore
}

function writeLog(entry) {
  const line = `[${new Date().toISOString()}] ${entry}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (err) {
    console.error('Failed to write log:', err);
  }
}

// Log incoming HTTP requests (static file hits, page loads, etc.)
app.use((req, res, next) => {
  writeLog(`HTTP ${req.method} ${req.url} from ${req.ip || req.connection.remoteAddress}`);
  next();
});

// Serve static files
app.use('/', express.static(path.join(__dirname, 'public')));

// Decide whether to use HTTPS or fallback to HTTP.
// Set environment variable USE_HTTP=1 to force HTTP (useful for LAN/dev).
let server;
let io;
const PORT = process.env.PORT || 3000;
const USE_HTTP = process.env.USE_HTTP === '1' || process.env.FORCE_HTTP === '1';

if (!USE_HTTP) {
  try {
    // Try to read cert files; fall back to HTTP if reading fails
    const options = {
      key: fs.readFileSync(path.join(__dirname, 'key.pem')),
      cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
    };
    server = https.createServer(options, app);
    io = new Server(server, { cors: { origin: '*' } });
    console.log('Using HTTPS server');
  } catch (err) {
    console.warn('Could not start HTTPS server (missing/invalid cert). Falling back to HTTP.\n', err.message);
    server = require('http').createServer(app);
    io = new Server(server, { cors: { origin: '*' } });
  }
} else {
  server = require('http').createServer(app);
  io = new Server(server, { cors: { origin: '*' } });
  console.log('Using HTTP server (forced by USE_HTTP=1)');
}

// =============================================
//            SOCKET.IO EVENTS
// =============================================
io.on('connection', (socket) => {
  const remote = socket.handshake.address || socket.request.connection.remoteAddress || 'unknown';
  console.log("User connected:", socket.id, remote);
  writeLog(`CONNECT socket=${socket.id} from=${remote}`);

  socket.on('join', (roomId) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;
    writeLog(`JOIN socket=${socket.id} room=${roomId} current=${count}`);

    if (count === 0) {
      socket.join(roomId);
      socket.emit("room_created", roomId);
      writeLog(`ROOM_CREATED socket=${socket.id} room=${roomId}`);
    } else if (count === 1) {
      socket.join(roomId);
      socket.emit("room_joined", roomId);
      writeLog(`ROOM_JOINED socket=${socket.id} room=${roomId}`);
    } else {
      socket.emit("full_room", roomId);
      writeLog(`ROOM_FULL socket=${socket.id} room=${roomId}`);
    }
  });

  socket.on("start_call", (roomId) => {
    socket.to(roomId).emit("start_call");
  });

  socket.on("webrtc_offer", ({ roomId, sdp }) => {
    socket.to(roomId).emit("webrtc_offer", sdp);
  });

  socket.on("webrtc_answer", ({ roomId, sdp }) => {
    socket.to(roomId).emit("webrtc_answer", sdp);
  });

  socket.on("webrtc_ice_candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("webrtc_ice_candidate", { candidate });
  });
  socket.on("leave", (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit("peer_left");
    writeLog(`LEAVE socket=${socket.id} room=${roomId}`);
  });

  socket.on('disconnect', (reason) => {
    writeLog(`DISCONNECT socket=${socket.id} reason=${reason}`);
    console.log('User disconnected:', socket.id, reason);
  });
});

// Start server on all interfaces so LAN peers can connect
server.listen(PORT, '0.0.0.0', () => {
  const proto = server instanceof https.Server ? 'https' : 'http';
  console.log(`Server running on ${proto}://0.0.0.0:${PORT}`);
  console.log('If connecting from another machine, open:', `${proto}://<SERVER_IP>:${PORT}`);
});
